#!/usr/bin/env python3
"""Install the companion as the current macOS user's LaunchAgent."""
import os
import plistlib
import subprocess
import time
from pathlib import Path

root = Path(__file__).resolve().parent
config = root / 'config.json'
if not config.is_file(): raise SystemExit('Create config.json first; see processor/README.md')
config.chmod(0o600)
label = 'com.freejira.video-worker'
plist = Path.home() / 'Library/LaunchAgents' / (label + '.plist')
plist.parent.mkdir(parents=True, exist_ok=True)
logs = root / 'logs'; logs.mkdir(exist_ok=True); logs.chmod(0o700)
content = {
    'Label': label,
    'ProgramArguments': ['/usr/bin/caffeinate', '-i', str(root / 'venv/bin/python'), str(root / 'worker.py'), '--config', str(config)],
    'WorkingDirectory': str(root), 'RunAtLoad': True, 'KeepAlive': True, 'ThrottleInterval': 30,
    'EnvironmentVariables': {'PYTHONUNBUFFERED': '1', 'PATH': str(root / 'runtime/media/bin') + ':/usr/bin:/bin:/usr/sbin:/sbin'},
    'StandardOutPath': str(logs / 'worker.log'), 'StandardErrorPath': str(logs / 'worker-error.log'),
}
plist.write_bytes(plistlib.dumps(content)); plist.chmod(0o600)
domain = f'gui/{os.getuid()}'
subprocess.run(['launchctl', 'bootout', domain + '/' + label], capture_output=True)
for attempt in range(20):
    result = subprocess.run(['launchctl', 'bootstrap', domain, str(plist)], capture_output=True)
    if result.returncode == 0: break
    time.sleep(.5)
else: raise SystemExit(result.stderr.decode().strip())
print('Freejira video processor installed; starts when this user logs in.')
