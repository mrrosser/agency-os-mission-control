"""Measure an explicitly selected local command; never interpret its output as authorization."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import threading
import time
import uuid


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project', required=True)
    parser.add_argument('--case', required=True)
    parser.add_argument('--kind', choices=['local-task', 'mocked-regression', 'live-model'], required=True)
    parser.add_argument('--receipt', required=True)
    parser.add_argument('--timeout', type=int, default=300)
    parser.add_argument('command', nargs=argparse.REMAINDER)
    args = parser.parse_args(argv)
    for value in [args.project, args.case]:
        if not re.fullmatch(r'[a-z][a-z0-9-]{0,63}', value): parser.error('invalid identifier')
    command = args.command[1:] if args.command[:1] == ['--'] else args.command
    if not command or not 1 <= args.timeout <= 3600: parser.error('command and bounded timeout required')
    # Explicit executable + argv, no shell interpolation. Reject shell script wrappers on Windows.
    if os.name == 'nt' and Path(command[0]).suffix.lower() in ('.cmd', '.bat'):
        parser.error('use the underlying executable instead of a batch wrapper')
    receipt = Path(args.receipt)
    receipt.parent.mkdir(parents=True, exist_ok=True)
    # Reserve the receipt before any work; repeated invocation cannot silently rerun a task.
    with receipt.open('x', encoding='utf-8') as output:
        row = dict(schema_version=1, event='measured_command', project_id=args.project,
                   case_id=args.case, evidence_kind=args.kind, correlation_id=str(uuid.uuid4()),
                   command_fingerprint=hashlib.sha256(json.dumps(command).encode()).hexdigest(),
                   status='started', exit_code=None, latency_ms=None, quality='unassessed',
                   authority='unknown', cost_usd=None, model_calls=None, execution_authorized=False)
        json.dump(row, output); output.flush()
        started = time.monotonic()
        counts = [0, 0]
        hashes = [hashlib.sha256(), hashlib.sha256()]
        def drain(stream, index):
            while block := stream.read(65536):
                counts[index] += len(block); hashes[index].update(block)
            stream.close()
        try:
            proc = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                    stderr=subprocess.PIPE, shell=False,
                                    creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
            threads = [threading.Thread(target=drain, args=(stream, i), daemon=True)
                       for i, stream in enumerate([proc.stdout, proc.stderr])]
            for thread in threads: thread.start()
            try:
                row['exit_code'] = proc.wait(timeout=args.timeout)
                row['status'] = 'command_passed' if row['exit_code'] == 0 else 'command_failed'
            except subprocess.TimeoutExpired:
                # Terminate the measured process; never claim all descendants stopped.
                proc.kill(); proc.wait()
                row['status'] = 'timeout'
            for thread in threads: thread.join(timeout=2)
            row['output_complete'] = not any(thread.is_alive() for thread in threads)
        except OSError:
            row['status'] = 'start_failed'
        row.update(latency_ms=round((time.monotonic()-started)*1000),
                   stdout_bytes=counts[0], stderr_bytes=counts[1],
                   stdout_sha256=hashes[0].hexdigest(), stderr_sha256=hashes[1].hexdigest())
        output.seek(0); json.dump(row, output, indent=2); output.truncate(); output.flush()
    print(json.dumps(row))
    return 0 if row['status'] == 'command_passed' else 1


if __name__ == '__main__':
    sys.exit(main())
