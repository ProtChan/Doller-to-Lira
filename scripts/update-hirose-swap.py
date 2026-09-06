#!/usr/bin/env python3
import json
import re
import urllib.request
from datetime import datetime, timezone
from html import unescape
from pathlib import Path

SOURCE = 'https://hirose-fx.co.jp/contents/news/Swap'
OUT = Path('data/hirose-usdtry-swap.json')
UA = 'Mozilla/5.0 (compatible; Doller-to-Lira/1.0; +https://github.com/ProtChan/Doller-to-Lira)'


def clean_html(fragment: str) -> str:
    text = re.sub(r'<br\s*/?>', ' ', fragment, flags=re.I)
    text = re.sub(r'<[^>]+>', '', text)
    return re.sub(r'\s+', ' ', unescape(text)).strip()


def fetch_html() -> str:
    req = urllib.request.Request(SOURCE, headers={'User-Agent': UA, 'Accept-Language': 'ja,en;q=0.8'})
    with urllib.request.urlopen(req, timeout=30) as r:
        raw = r.read()
        charset = r.headers.get_content_charset() or 'utf-8'
    try:
        return raw.decode(charset)
    except UnicodeDecodeError:
        return raw.decode('utf-8', errors='replace')


def parse_latest(html: str) -> dict:
    # Find the USD/TRY row and parse its cells.
    rows = re.findall(r'<tr\b[^>]*>(.*?)</tr>', html, flags=re.I | re.S)
    target = None
    for row_html in rows:
        if 'USD/TRY' not in clean_html(row_html):
            continue
        cells = re.findall(r'<t[dh]\b[^>]*>(.*?)</t[dh]>', row_html, flags=re.I | re.S)
        values = [clean_html(c) for c in cells]
        if values and values[0].replace(' ', '') == 'USD/TRY':
            target = values
            break
    if not target or len(target) < 7:
        raise RuntimeError(f'USD/TRY row not found or malformed: {target!r}')

    # The current table date is the closest non-linked Japanese date immediately before the table.
    table_pos = html.find('<table')
    prefix = html[:table_pos if table_pos >= 0 else html.find('USD/TRY')]
    prefix_without_links = re.sub(r'<a\b[^>]*>.*?</a>', ' ', prefix, flags=re.I | re.S)
    date_matches = list(re.finditer(r'(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日', clean_html(prefix_without_links)))
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
