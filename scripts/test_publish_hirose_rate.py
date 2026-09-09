#!/usr/bin/env python3
import json
import tempfile
import unittest
from pathlib import Path

from publish_hirose_rate import parse_payload, update_feed


class PublishHiroseRateTest(unittest.TestCase):
    def event(self, payload):
        return {
            "issue": {
                "body": "header\n<!-- DTL_HIROSE_RATE_V1\n" + json.dumps(payload) + "\n-->"
            }
        }

    def test_valid_payload_and_merge(self):
        payload = parse_payload(self.event({
            "date": "2026-09-08",
            "usdTryAskClose23": 48.461,
            "usdJpyAskClose23": 154.005,
            "usdTryAskDayHigh": 48.9,
            "usdJpyAskDayHigh": 155.1,
        }))
        feed = {
            "history": [
                {"date": "2026-09-07", "usdTryAskClose23": 48.4351, "usdJpyAskClose23": 154.289}
            ]
        }
        updated, changed = update_feed(feed, payload, "2026-09-09T00:00:00Z")
        self.assertTrue(changed)
        self.assertEqual(updated["historyEnd"], "2026-09-08")
        self.assertEqual(updated["records"], 2)
        row = updated["history"][-1]
        self.assertEqual(row["usdTryAskDayHigh"], 48.9)
        self.assertEqual(row["verification"], "owner-manual")

        again, changed_again = update_feed(updated, payload, "2026-09-09T01:00:00Z")
        self.assertFalse(changed_again)
        self.assertEqual(again["history"][-1]["publishedAt"], "2026-09-09T00:00:00Z")

    def test_rejects_high_below_close(self):
        with self.assertRaisesRegex(ValueError, "usdTryAskDayHigh"):
            parse_payload(self.event({
                "date": "2026-09-08",
                "usdTryAskClose23": 48.461,
                "usdJpyAskClose23": 154.005,
                "usdTryAskDayHigh": 48.4,
            }))


if __name__ == "__main__":
    unittest.main()
