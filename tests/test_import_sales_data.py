import importlib.util
import sys
import unittest
from datetime import date
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "import_sales_data.py"
SPEC = importlib.util.spec_from_file_location("import_sales_data", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class ImportSalesDataTests(unittest.TestCase):
    def test_brazilian_number(self):
        self.assertEqual(MODULE.br_number("1.234,56"), 1234.56)
        self.assertEqual(MODULE.br_number("-89,90"), -89.90)
        self.assertEqual(MODULE.br_number(""), 0)

    def test_last_closed_week(self):
        start, end = MODULE.last_closed_week(date(2026, 7, 16))
        self.assertEqual(start.isoformat(), "2026-07-06")
        self.assertEqual(end.isoformat(), "2026-07-11")

    def test_fixed_mtd_and_mty_bounds(self):
        periods = MODULE.fixed_period_bounds(date(2026, 7, 15))
        self.assertEqual(periods["mtd"]["current"], (date(2026, 7, 1), date(2026, 7, 15)))
        self.assertEqual(periods["mtd"]["previous"], (date(2025, 7, 1), date(2025, 7, 15)))
        self.assertEqual(periods["mty"]["current"], (date(2026, 1, 1), date(2026, 7, 15)))
        self.assertEqual(periods["mty"]["previous"], (date(2025, 1, 1), date(2025, 7, 15)))

    def test_diagnosis_neutrality(self):
        self.assertEqual(MODULE.diagnosis(0.5, 0.1), "Estável")
        self.assertEqual(MODULE.diagnosis(4.0, -0.5), "Crescimento com perda de rentabilidade")
        self.assertEqual(MODULE.diagnosis(-4.0, -0.5), "Categoria crítica")

    def test_margin_is_weighted(self):
        metrics = MODULE.Metrics()
        metrics.base_present = 1000
        metrics.profit_present = 125
        self.assertEqual(metrics.json()["margin"], 12.5)

    def test_margin_header_is_the_present_profit_column(self):
        self.assertEqual(MODULE.normalized_header("% Lucro pres."), "%lucropres.")
        self.assertNotEqual(MODULE.normalized_header("%Lucro"), "%lucropres.")


if __name__ == "__main__":
    unittest.main()
