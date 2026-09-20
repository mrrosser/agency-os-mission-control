import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = str(Path(__file__).with_name('measure_command.py'))

class MeasureTests(unittest.TestCase):
    def run_case(self, target, code, timeout=5):
        return subprocess.run([sys.executable, SCRIPT, '--project', 'test', '--case', 'check',
          '--kind', 'mocked-regression', '--receipt', str(target), '--timeout', str(timeout),
          '--', sys.executable, '-c', code], capture_output=True, text=True)

    def test_redaction_unknown_cost_and_duplicate_prevention(self):
        with tempfile.TemporaryDirectory() as root:
            target = Path(root)/'receipt.json'
            result = self.run_case(target, "print('PRIVATE-PAYLOAD')")
            self.assertEqual(result.returncode, 0)
            row=json.loads(target.read_text())
            self.assertNotIn('PRIVATE', target.read_text())
            self.assertIsNone(row['cost_usd'])
            self.assertEqual(row['quality'], 'unassessed')
            self.assertFalse(row['execution_authorized'])
            self.assertGreater(row['stdout_bytes'], 0)
            self.assertNotEqual(self.run_case(target, 'pass').returncode, 0)

    def test_failure_and_timeout_receipts(self):
        with tempfile.TemporaryDirectory() as root:
            for name, code, expected in [('fail', 'raise SystemExit(4)', 'command_failed'),
                                         ('timeout', 'import time;time.sleep(3)', 'timeout')]:
                target=Path(root)/(name+'.json')
                self.assertEqual(self.run_case(target, code, 1).returncode, 1)
                self.assertEqual(json.loads(target.read_text())['status'], expected)

if __name__ == '__main__': unittest.main()
