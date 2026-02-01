# Common Errors and Fixes

## Bracketed paste breaks commands
Symptom: commands appear with `^[[200~` and fail (e.g., `tmux` not found).
Fix: type commands manually or run:

```bash
bind 'set enable-bracketed-paste off'
```

## Missing env vars (OPENAI_API_KEY, GOOGLE_API_KEY)
Symptom: `MissingEnvVarError` when running OpenClaw CLI.
Fix:
1) Add to `~/ai-hell-mary/docker/.env`
2) Recreate container with `scripts/gateway_recreate.sh`

## Plugin load errors
Symptom: plugin fails to load, or `memory-lancedb` disabled.
Fix:
- Ensure deps installed in Dockerfile
- Rebuild with `scripts/gateway_rebuild.sh`

## "gog not installed"
Symptom: `openclaw webhooks gmail setup` fails.
Fix:
- Ensure gog is installed in the container image.
- Rebuild gateway image if needed.

## Build failures / no space left on device
Fix:
```bash
docker builder prune -f
docker system df
```
