"""Run the documented create examples against inert CLI stubs, never providers."""
from pathlib import Path
import json
import os
import re
import subprocess
import tempfile

source = Path(__file__).resolve().parents[1] / 'packages/universal/commands/create-mr.md'
text = source.read_text()
results = []
with tempfile.TemporaryDirectory(prefix='create mr transport ') as directory:
    root = Path(directory)
    marker = root / 'must-not-exist'
    body = f'## Summary\nLiteral `code` and $(touch "{marker}")\nSecond line: a & b'
    body_file = root / 'body with spaces.md'
    body_file.write_text(body)
    stub = '#!/usr/bin/env python3\nimport json,sys\nprint(json.dumps(sys.argv[1:]))\n'
    for cli in ('gh', 'glab'):
        executable = root / cli
        executable.write_text(stub)
        executable.chmod(0o755)
    git = root / 'git'
    git.write_text('#!/bin/sh\nprintf "%s\\n" "feature/export"\n')
    git.chmod(0o755)
    title = 'FEATURE: ABC-123 - Keep $(printf literal) and `code`'
    env = dict(os.environ, PATH=str(root) + os.pathsep + os.environ['PATH'], MR_TITLE=title, MR_BODY_FILE=str(body_file), DEFAULT_BRANCH='main')
    for cli in ('gh', 'glab'):
        match = re.search(r'```bash\n(' + cli + r' (?:pr|mr) create [\s\S]*?)\n```', text)
        assert match, cli
        output = subprocess.run(['bash', '-c', match[1]], env=env, text=True, check=True, capture_output=True)
        args = json.loads(output.stdout)
        assert '--draft' in args, args
        assert args[args.index('--title') + 1] == title, args
        if cli == 'gh':
            assert args[args.index('--body-file') + 1] == str(body_file), args
            assert args[args.index('--head') + 1] == 'feature/export', args
            assert args[args.index('--base') + 1] == 'main', args
        else:
            assert args[args.index('--description') + 1] == body, args
            assert args[args.index('--source-branch') + 1] == 'feature/export', args
            assert args[args.index('--target-branch') + 1] == 'main', args
        assert not marker.exists(), 'Description was interpreted as shell code'
        results.append({'cli':cli,'result':'passed','checked':'draft flag, branch/title/body argument fidelity, no literal-code execution'})
print(json.dumps({'status':'passed','scope':'inert command-transport checks only; no provider calls or workflow-quality claims','results':results},indent=2))
