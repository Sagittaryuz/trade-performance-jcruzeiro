import importlib.util
import sys
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "repair_overflow_metrics.py"
SPEC = importlib.util.spec_from_file_location("repair_overflow_metrics", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class RepairOverflowMetricsTests(unittest.TestCase):
    def test_cost_repair_preserves_present_profit_and_margin(self):
        value = {
            "sale": 100.0,
            "cost": -MODULE.OVERFLOW_UNIT + 80.0,
            "basePresent": 95.0,
            "profit": MODULE.OVERFLOW_UNIT + 20.0,
            "profitPresent": 11.4,
            "margin": 12.0,
        }
        counters = {"objects": 0, "rows": 0}

        MODULE.repair_metrics(value, counters)

        self.assertAlmostEqual(value["cost"], 80.0, places=2)
        self.assertAlmostEqual(value["profit"], 20.0, places=2)
        self.assertEqual(value["profitPresent"], 11.4)
        self.assertEqual(value["margin"], 12.0)
        self.assertEqual(counters, {"objects": 1, "rows": 1})


if __name__ == "__main__":
    unittest.main()
