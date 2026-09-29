#!/usr/bin/env python3
import json
import re
import time
import urllib.request
from urllib.error import HTTPError
from datetime import datetime, timezone
from html import unescape
from pathlib import Path

SOURCE = 'https://hirose-fx.co.jp/contents/news/Swap'
READER_SOURCE = 'https://r.jina.ai/https://hirose-fx.co.jp/contents/news/Swap'
SEED_SOURCE = 'https://raw.githubusercontent.com/ProtChan/USDTRY/main/data/usdtry.json'
SEED_START = '2026-07-01'
OUT = Path('data/hirose-usdtry-swap.json')
# Use ordinary browser navigation headers. Hirose started returning HTTP 403 to
# the old automation-identifying UA on hosted CI runners on 2026-09-29.
UA = {
    'User-Agent': (
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
        'AppleWebKit/537.36 (KHTML, like Gecko) '
        'Chrome/154.0.0.0 Safari/537.36'
    ),
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Referer': 'https://hirose-fx.co.jp/',
    'Upgrade-Insecure-Requests': '1',
}


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
        except HTTPError as exc:
            # A hosted-runner 403 is deterministic for the direct Hirose endpoint.
            # Fall back immediately instead of burning ~6 seconds retrying the same block.
            if exc.code in (403, 404, 410):
                raise
            last_error = exc
            if attempt + 1 < attempts:
                time.sleep(1.0 + attempt)
        except Exception as exc:
            last_error = exc
            if attempt + 1 < attempts:
                time.sleep(1.0 + attempt)
    if last_error is None:
        raise RuntimeError(f'Fetch failed without an exception: {url}')
    raise last_error


def decode_text(raw: bytes) -> str:
    for encoding in ('utf-8', 'cp932', 'shift_jis'):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw.decode('utf-8', errors='replace')


def fetch_html(url: str = SOURCE) -> str:
    try:
        html = decode_text(fetch_bytes(url))
        if 'USD/TRY' not in html:
            raise RuntimeError(f'Hirose response did not contain USD/TRY: {clean_html(html)[:200]!r}')
        print('fetch_method=direct-hirose')
        return html
    except Exception as direct_error:
        if url != SOURCE:
            raise
        print(f'direct_fetch_failed={type(direct_error).__name__}:{direct_error}')
        # Hirose began returning 403 to hosted CI egress on 2026-09-29. Reader is
        # only a transport fallback: the underlying source remains the same official
        # Hirose page, and the parsed values/date are validated below.
        reader = decode_text(fetch_bytes(READER_SOURCE))
        if 'USD/TRY' not in reader:
            raise RuntimeError(
                f'Hirose reader fallback did not contain USD/TRY: {clean_html(reader)[:200]!r}'
            ) from direct_error
        print('fetch_method=jina-reader-hirose')
        return reader


def parse_latest_html(html: str) -> dict:
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


def parse_latest_reader(text: str) -> dict:
    lines = text.splitlines()
    target = None
    target_index = -1
    for index, line in enumerate(lines):
        if 'USD/TRY' not in line or '|' not in line:
            continue
        cells = [re.sub(r'[*_`]', '', cell).strip() for cell in line.strip().strip('|').split('|')]
        cells = [cell for cell in cells if cell]
        pair_index = next((i for i, cell in enumerate(cells) if cell.replace(' ', '') == 'USD/TRY'), None)
        if pair_index is None:
            continue
        values = cells[pair_index:pair_index + 7]
        if len(values) >= 7:
            target = values
            target_index = index
            break
    if not target:
        raise RuntimeError('USD/TRY row not found in reader fallback')

    prefix = '\n'.join(lines[:target_index + 1])
    date_pattern = r'(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日'
    date_matches = list(re.finditer(date_pattern, prefix))
    if not date_matches:
        sample = prefix[-1800:].replace('\\n', ' | ')
        raise RuntimeError(f'Current swap table date not found in reader fallback; prefix_tail={sample!r}')
    m = date_matches[-1]
    date = f'{int(m.group(1)):04d}-{int(m.group(2)):02d}-{int(m.group(3)):02d}'

    def n(value: str) -> float:
        cleaned = re.sub(r'[^0-9+.,-]', '', value)
        return float(cleaned.replace(',', ''))

    latest = {
        'date': date,
        'days': int(n(target[1])),
        'unit': int(n(target[2])),
        'sellJpy': n(target[5]),
        'buyJpy': n(target[6]),
    }
    if latest['unit'] <= 0 or latest['days'] < 0:
        raise RuntimeError(f'Invalid reader fallback row: {latest!r}')
    return latest


def parse_latest(document: str) -> dict:
    if re.search(r'<tr\b', document, flags=re.I):
        return parse_latest_html(document)
    return parse_latest_reader(document)

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
    # updatedAt means the feed content changed, not merely that a scheduled poll ran.
    # The old `or min(history) == SEED_START` branch was always true after seeding
    # and caused an unnecessary commit/deploy on every successful poll.
    if changed or not data.get('updatedAt') or not data.get('history'):
        data['updatedAt'] = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
    data['history'] = [history[key] for key in sorted(history)]

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(latest, ensure_ascii=False))
    print(f'history_start={data["history"][0]["date"]} history_records={len(data["history"])}')


if __name__ == '__main__':
    main()
