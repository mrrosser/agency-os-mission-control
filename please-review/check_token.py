import pathlib
path = pathlib.Path('/etc/openclaw/openclaw.env')
token = ''
if path.exists():
    for line in path.read_text().splitlines():
        if line.startswith('OPENCLAW_GATEWAY_TOKEN='):
            token = line.split('=',1)[1].strip()
            break
print('TOKEN_OK' if token else 'TOKEN_EMPTY')