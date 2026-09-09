#!/usr/bin/env python3
import argparse
import json
import re
from copy import deepcopy
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

MARKER_RE = re.compile(r"<!--\s*DTL_HIROSE_RATE_V1\s*(\{.*?\})\s*-->", re.S)


def as_positive_float(payload, key, required=True):
    value = payload.get(key)
    if value is None and not required:
        return None
    try:
        value = float(value)
    except (TypeError, ValueError):
        raise ValueError(f"{key} must be numeric")
    if not value > 0:
        raise ValueError(f"{key} must be > 0")
    if value > 10000:
        raise ValueError(f"{key} is implausibly large")
    return value


def parse_payload(event):
    issue = event.get("issue") or {}
    body = issue.get("body") or ""
    match = MARKER_RE.search(body)
    if not match:
        raise ValueError("DTL_HIROSE_RATE_V1 payload not found")
    payload = json.loads(match.group(1))

    raw_date = str(payload.get("date") or "")
    try:
        target_date = date.fromisoformat(raw_date)
    except ValueError as exc:
        raise ValueError("date must be YYYY-MM-DD") from exc

    today_jst = datetime.now(ZoneInfo("Asia/Tokyo")).date()
    if target_date > today_jst:
        raise ValueError(f"future date is not allowed: {target_date}")
    if target_date.year < 2020:
        raise ValueError("date is outside the supported range")

    usd_try_close = as_positive_float(payload, "usdTryAskClose23")
    usd_jpy_close = as_positive_float(payload, "usdJpyAskClose23")
    usd_try_high = as_positive_float(payload, "usdTryAskDayHigh")
    usd_jpy_high = as_positive_float(payload, "usdJpyAskDayHigh", required=False)

    if usd_try_high < usd_try_close:
        raise ValueError("usdTryAskDayHigh must be >= usdTryAskClose23")
    if usd_jpy_high is not None and usd_jpy_high < usd_jpy_close:
        raise ValueError("usdJpyAskDayHigh must be >= usdJpyAskClose23")

    clean = {
        "date": raw_date,
        "usdTryAskClose23": usd_try_close,
        "usdJpyAskClose23": usd_jpy_close,
        "usdTryAskDayHigh": usd_try_high,
    }
    if usd_jpy_high is not None:
        clean["usdJpyAskDayHigh"] = usd_jpy_high
    return clean


def update_feed(feed, payload, published_at):
    result = deepcopy(feed)
    history = list(result.get("history") or [])
    by_date = {str(row.get("date")): row for row in history if isinstance(row, dict) and row.get("date")}

    existing = deepcopy(by_date.get(payload["date"], {}))
    comparable_keys = ["usdTryAskClose23", "usdJpyAskClose23", "usdTryAskDayHigh", "usdJpyAskDayHigh"]
    changed = any(
        key in payload and existing.get(key) != payload.get(key)
        for key in comparable_keys
    )
    changed = changed or not existing

    row = existing
    row.update(payload)
    row["verification"] = "owner-manual"
    if changed:
        row["publishedAt"] = published_at
    by_date[payload["date"]] = row

    sorted_history = [by_date[key] for key in sorted(by_date)]
    result["source"] = "Hirose LION FX ASK"
    result["price"] = "ASK"
    result["timeframe"] = "60m"
    result["barTime"] = "23:00 JST"
    result["closeField"] = "終値"
    result["description"] = "Historical Hirose ASK CSV plus owner-verified daily publication. usdTryAskDayHigh is the intraday maximum ASK used as the adverse short-position reference."
    result["historyStart"] = sorted_history[0]["date"] if sorted_history else None
    result["historyEnd"] = sorted_history[-1]["date"] if sorted_history else None
    result["records"] = len(sorted_history)
    result["history"] = sorted_history
    if changed:
        result["lastManualPublication"] = published_at
    return result, changed


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--event", required=True)
    parser.add_argument("--data", default="data/hirose-ask-close-23.json")
    args = parser.parse_args()

    event = json.loads(Path(args.event).read_text(encoding="utf-8"))
    payload = parse_payload(event)
    data_path = Path(args.data)
    feed = json.loads(data_path.read_text(encoding="utf-8"))
    published_at = datetime.now(ZoneInfo("UTC")).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    updated, changed = update_feed(feed, payload, published_at)

    if changed:
        data_path.write_text(json.dumps(updated, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(json.dumps({"date": payload["date"], "changed": changed, "row": payload}, ensure_ascii=False))


if __name__ == "__main__":
    main()
