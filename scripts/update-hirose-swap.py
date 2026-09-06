#!/usr/bin/env python3
import json
import re
import shutil
import subprocess
import time
import urllib.request
from datetime import datetime, timezone
from html import unescape
from pathlib import Path

SOURCE = 'https://hirose-fx.co.jp/contents/news/Swap'
OUT = Path('data/hirose-usdtry-swap.json')
UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'


def clean_html(fragment: str) -> str:
    text = re.sub(r'<br\s*/?>', ' ', fragment, flags=re.I)
    text = re.sub(r'<[^>]+>', '', text)
    return re.sub(r'\s+', ' ', unescape(text)).strip()


def fetch_with_http() -> str:
    req = urllib.request.Request(SOURCE, headers={
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ja-JP,ja;q=0.9,en;q=0.7',
        'Referer': 'https://hirose-fx.co.jp/',
        'Cache-Control': 'no-cache',
    })
    with urllib.request.urlopen(req, timeout=30) as r:
        raw = r.read()
        charset = r.headers.get_content_charset() or 'utf-8'
    try:
        return raw.decode(charset)
    except UnicodeDecodeError:
        return raw.decode('utf-8', errors='replace')


def fetch_with_chrome() -> str:
    chrome = next((p for name in ('google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser') if (p := shutil.which(name))), None)
    if not chrome:
        raise RuntimeError('Chrome/Chromium executable not found')
    url = f'{SOURCE}?dtl={int(time.time())}'
    proc = subprocess.run([
        chrome,
        '--headless=new',
        '--no-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--disable-background-networking',
        '--no-first-run',
        '--no-default-browser-check',
        f'--user-agent={UA}',
        '--dump-dom',
        url,
    ], capture_output=True, text=True, timeout=45, check=False)
    if proc.returncode != 0:
        raise RuntimeError(f'Chrome exited {proc.returncode}: {proc.stderr[-500:]}')
    html = proc.stdout
    if 'USD/TRY' not in html:
        raise RuntimeError(f'Chrome page did not contain USD/TRY; body head={clean_html(html)[:200]!r}')
    return html


def fetch_html() -> str:
    errors = []
    try:
        html = fetch_with_http()
        if 'USD/TRY' in html:
            print('fetch_method=http')
            return html
        errors.append('HTTP response missing USD/TRY')
    except Exception as exc:
        errors.append(f'http={exc}')

    try:
        html = fetch_with_chrome()
        print('fetch_method=chrome')
        return html
    except Exception as exc:
        errors.append(f'chrome={exc}')

    raise RuntimeError('Hirose fetch failed: ' + ' | '.join(errors))


def parse_latest(html: str) -> dict:
    rows = re.findall(r'<tr\b[^>]*>(.*?)</tr>', html, flags=re.I | re.S)
    target = None
    target_pos = None
    for match in re.finditer(r'<tr\b[^>]*>(.*?)</tr>', html, flags=re.I | re.S):
        row_html = match.group(1)
        if 'USD/TRY' not in clean_html(row_html):
            continue
        cells = re.findall(r'<t[dh]\b[^>]*>(.*?)</t[dh]>', row_html, flags=re.I | re.S)
        values = [clean_html(c) for c in cells]
        if values and values[0].replace(' ', '') == 'USD/TRY':
            target = values
            target_pos = match.start()
            break
    if not target or len(target) < 7:
        raise RuntimeError(f'USD/TRY row not found or malformed: {target!r}; rows={len(rows)}')

    # The current table date is the non-linked date immediately before the USD/TRY table.
    prefix = html[:target_pos]
    prefix_without_links = re.sub(r'<a\b[^>]*>.*?</a>', ' ', prefix, flags=re.I | re.S)
    date_matches = list(re.finditer(r'(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日', clean_html(prefix_without_links)))
    if not date_matches:
        # Some rendered DOMs flatten navigation; fall back to the last Japanese date before the row.
        date_matches = list(re.finditer(r'(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日', clean_html(prefix)))
    if not date_matches:
        raise RuntimeError('Current swap table date not found')
    m = date_matches[-1]
    date = f'{int(m.group(1)):04d}-{int(m.group(2)):02d}-{int(m.group(3)):02d}'

    def n(s: str):
        return float(s.replace(',', ''))

    return {
        'date': date,
        'days': int(float(target[1].replace(',', ''))),
        'unit': int(float(target[2].replace(',', ''))),
        'sellJpy': n(target[5]),
        'buyJpy': n(target[6]),
    }


def main():
    latest = parse_latest(fetch_html())
    if latest['unit'] <= 0:
        raise RuntimeError(f'Invalid Hirose lot unit: {latest}')

    data = {
        'source': SOURCE,
        'pair': 'USD/TRY',
        'updatedAt': None,
        'history': [],
    }
    if OUT.exists():
        try:
            data.update(json.loads(OUT.read_text(encoding='utf-8')))
        except Exception:
            pass

    history = {row['date']: row for row in data.get('history', []) if isinstance(row, dict) and row.get('date')}
    changed = history.get(latest['date']) != latest
    history[latest['date']] = latest
    data['source'] = SOURCE
    data['pair'] = 'USD/TRY'
    if changed or not data.get('updatedAt'):
        data['updatedAt'] = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
    data['history'] = [history[k] for k in sorted(history)]
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(latest, ensure_ascii=False))


if __name__ == '__main__':
    main()
