import fs from 'node:fs';
import path from 'node:path';

const scriptsDir = new URL('./', import.meta.url);
const files = fs.readdirSync(scriptsDir)
  .filter((name) => /^e2e.*\.mjs$/.test(name))
  .sort();

const errors = [];
for (const name of files) {
  const fullPath = path.join(scriptsDir.pathname, name);
  const source = fs.readFileSync(fullPath, 'utf8');

  // Production calendar snapshots are not test fixtures. Dates must be derived from
  // current feeds/history or generated relative to a derived date.
  const dateLiteral = /(['"`])((?:19|20)\d{2}-\d{2}-\d{2})\1/g;
  for (const match of source.matchAll(dateLiteral)) {
    const line = source.slice(0, match.index).split('\n').length;
    errors.push(`${name}:${line}: fixed ISO date literal ${match[2]} is forbidden; derive it from feed/history/rules`);
  }

  // A literal position lot other than the normalized 1-lot unit fixture is almost
  // always a leaked production scenario. Derived variables (lots, editedLots, etc.)
  // are allowed and are the preferred way to test scaling/risk behavior.
  const literalLots = /\blots\s*:\s*(\d+(?:\.\d+)?)/g;
  for (const match of source.matchAll(literalLots)) {
    if (Number(match[1]) === 1) continue;
    const line = source.slice(0, match.index).split('\n').length;
    errors.push(`${name}:${line}: hard-coded position lots=${match[1]} is forbidden; use 1-lot normalization or derive lots from the rule under test`);
  }

  // Net return is not generally monotonic. Reject obvious assertions that compare
  // one Net observation directionally against another. Test Net = FX + Swap instead.
  const lines = source.split('\n');
  lines.forEach((lineText, index) => {
    const lower = lineText.toLowerCase();
    const netMentions = (lower.match(/net/g) || []).length;
    if (netMentions >= 2 && /assert\.(?:ok|equal|deepequal)/i.test(lineText) && /[<>]/.test(lineText)) {
      errors.push(`${name}:${index + 1}: directional Net-vs-Net assertion is forbidden; Net may rise or fall with FX`);
    }
  });
}

if (errors.length) {
  console.error('E2E fixture policy violations:\n' + errors.map((item) => `- ${item}`).join('\n'));
  process.exit(1);
}

console.log(`E2E fixture policy: PASS (${files.length} files; no fixed production dates/lots or Net monotonicity assertions)`);
