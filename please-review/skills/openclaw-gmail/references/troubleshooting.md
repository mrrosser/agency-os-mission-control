# Gmail Webhook Troubleshooting

Problem: gog not installed
- Fix: rebuild the gateway image so gog is included.
- Verify: `docker exec openclaw-gateway gog --version`

Problem: gcloud not installed
- Fix: rebuild the gateway image so gcloud is included.
- Verify: `docker exec openclaw-gateway gcloud --version`

Problem: MissingEnvVar OPENAI_API_KEY
- Fix: add `OPENAI_API_KEY=...` to `~/ai-hell-mary/docker/.env`, then recreate the container.
- Verify: `docker exec openclaw-gateway openclaw status`

Problem: Pub/Sub push endpoint 404/410
- Fix: ensure the Chat webhook path matches `--path` and funnel/serve routes to `http://127.0.0.1:18789<path>`.

Problem: Permission denied / 401 / 403
- Fix: run `gog auth login` for the correct account and ensure Gmail API is enabled.

Problem: Port already in use
- Fix: pick a new port and rerun setup.

Problem: No events after setup
- Fix: run `openclaw webhooks gmail run` manually and send a test email.
- Check: `docker logs --since 15m openclaw-gateway | rg -i "gmail|pubsub|webhook|error"`
