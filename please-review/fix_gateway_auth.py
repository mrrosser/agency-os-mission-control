import json, pathlib
path = pathlib.Path('/home/marcu/.openclaw/openclaw.json')
cfg = json.loads(path.read_text())
gateway = cfg.setdefault('gateway', {})
auth = gateway.setdefault('auth', {})
auth.setdefault('mode', 'token')
if not auth.get('token'):
    auth['token'] = '${OPENCLAW_GATEWAY_TOKEN}'
path.write_text(json.dumps(cfg, indent=2))
print('updated')