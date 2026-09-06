#!/usr/bin/env python3
import json
import re
import time
import urllib.request
from datetime import datetime, timezone
from html import unescape
from pathlib import Path

SOURCE = 'https://hirose-fx.co.jp/contents/news/Swap'
SEED_SOURCE = 'https://raw.githubusercontent.com/ProtChan/USDTRY/main/data/usdtry.json'
SEED_START = '2026-07-01'
OUT = Path('data/hirose-usdtry-swap.json')
# Keep the same lightweight request style that is already working in ProtChan/USDTRY.
UA = {'User-Agent': 'Mozilla/5.0 USDTRY-swap-watch/1.3'}


def clean_html(fragment: str) -> str:
    text = re.sub(r'<br\s*/?>', ' ', fragment, flags=re.I)
    text = re.sub(r'<[^>]+>', '', text)
    return re.sub(r'\s+', ' ', unescape(text).replace('\xa0', ' ')).strip()


def fetch_bytes(url: str, attempts: int = 3) -> bytes:
    last_error = None
    for attempt in range(attempts):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=30) as response:
                return response.read()
        except Exception as exc:
            last_error = exc
            if attempt + 1 < attempts:
                time.sleep(2.0 + attempt * 2.0)
    if last_error is None:
        raise RuntimeError(f'Fetch failed without an exception: {url}')
    raise last_error


def fetch_html(url: str = SOURCE) -> str:
    raw = fetch_bytes(url)
    for encoding in ('utf-8', 'cp932', 'shift_jis'):
        try:
            html = raw.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    else:
        html = raw.decode('utf-8', errors='replace')

    if 'USD/TRY' not in html:
        raise RuntimeError(f'Hirose response did not contain USD/TRY: {clean_html(html)[:200]!r}')
    print('fetch_method=urllib-usdtry-proven')
    return html


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

    # Current table date: ignore dates inside navigation links before the USD/TRY row.
    prefix = html[:target_pos]
    prefix_without_links = re.sub(r'<a\b[^>]*>.*?</a>', ' ', prefix, flags=re.I | re.S)
    date_pattern = r'(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日'
    date_matches = list(re.finditer(date_pattern, clean_html(prefix_without_links)))
    if not date_matches:
        date_matches = list(re.finditer(date_pattern, clean_html(prefix)))
    if not date_matches:
        raise RuntimeError('Current swap table date not found')
    m = date_matches[-1]
    date = f'{int(m.group(1)):04d}-{int(m.group(2)):02d}-{int(m.group(3)):02d}'

    def n(value: str) -> float:
        return float(value.replace(',', ''))

    return {
        'date': date,
        'days': int(float(target[1].replace(',', ''))),
        'unit': int(float(target[2].replace(',', ''))),
        'sellJpy': n(target[5]),
        'buyJpy': n(target[6]),
    }


def load_seed_history() -> list[dict]:
    raw = fetch_bytes(SEED_SOURCE)
    payload = json.loads(raw.decode('utf-8'))
    rows = []
    for source_row in payload.get('data', []):
        date = str(source_row.get('date') or '')
        if not date or date < SEED_START:
            continue
        unit = int(source_row.get('lot_size') or 0)
        sell = source_row.get('sell_yen')
        buy = source_row.get('buy_yen')
        days = int(source_row.get('days') or 0)
        if unit <= 0 or sell is None or buy is None:
            continue
        rows.append({
            'date': date,
            'days': days,
            'unit': unit,
            'sellJpy': float(sell),
            'buyJpy': float(buy),
        })
    if not rows or rows[0]['date'] != SEED_START:
        raise RuntimeError(f'Historical Hirose seed did not start at {SEED_START}: first={rows[0]["date"] if rows else None}')
    print(f'seed_history={rows[0]["date"]}..{rows[-1]["date"]} records={len(rows)}')
    return rows


def main():
    latest = parse_latest(fetch_html())
    if latest['unit'] <= 0:
        raise RuntimeError(f'Invalid Hirose lot unit: {latest}')

    data = {
        'source': SOURCE,
        'seedSource': SEED_SOURCE,
        'historyStart': SEED_START,
        'pair': 'USD/TRY',
        'updatedAt': None,
        'history': [],
    }
    if OUT.exists():
        try:
            data.update(json.loads(OUT.read_text(encoding='utf-8')))
        except Exception:
            pass

    history = {
        row['date']: row
        for row in data.get('history', [])
        if isinstance(row, dict) and row.get('date')
    }

    # One-time/backstop historical seed. Once July history is present, hourly runs only
    # need Hirose's current table, but this also repairs a feed that lost its old rows.
    if not history or min(history) > SEED_START:
        for row in load_seed_history():
            history[row['date']] = row

    changed = history.get(latest['date']) != latest
    history[latest['date']] = latest
    data['source'] = SOURCE
    data['seedSource'] = SEED_SOURCE
    data['historyStart'] = SEED_START
    data['pair'] = 'USD/TRY'
    if changed or not data.get('updatedAt') or not data.get('history') or min(history) == SEED_START:
        data['updatedAt'] = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
    data['history'] = [history[key] for key in sorted(history)]

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(latest, ensure_ascii=False))
    print(f'history_start={data["history"][0]["date"]} history_records={len(data["history"])}')


if __name__ == '__main__':
    main()
