# OpenClaw Paths

Gateway VM (host)
- Repo root: ~/ai-hell-mary
- Docker compose: ~/ai-hell-mary/docker/docker-compose.yml
- Docker env file: ~/ai-hell-mary/docker/.env
- OpenClaw data: ~/ai-hell-mary/data/openclaw
- OpenClaw config: ~/ai-hell-mary/data/openclaw/openclaw.json
- Workspace root: ~/ai-hell-mary/data/openclaw/workspace

Container (openclaw-gateway)
- Config: /home/openclaw/.openclaw/openclaw.json (bind mount)
- Workspace: /home/openclaw/.openclaw/workspace
- Exec approvals: /home/openclaw/.openclaw/exec-approvals.json

Useful commands
- Logs: docker logs --since 15m openclaw-gateway
- Status: docker exec openclaw-gateway openclaw status
- Health: docker exec openclaw-gateway openclaw health
