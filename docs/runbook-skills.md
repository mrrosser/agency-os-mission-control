# Runbook: Skills Import and Curation

PLACEHOLDERS (set these before running commands)
- GLOBAL_SKILLS_DIR=PLACEHOLDER_GLOBAL_SKILLS_DIR
- WORKSPACE_SKILLS_DIR=data/openclaw/workspace/skills

Goal
- Import your global skills into the OpenClaw workspace safely.

Steps (Linux/WSL)
- `mkdir -p "$WORKSPACE_SKILLS_DIR"`
- `cp -R "$GLOBAL_SKILLS_DIR"/* "$WORKSPACE_SKILLS_DIR"/`

Steps (Windows PowerShell)
- `New-Item -ItemType Directory -Force -Path $WORKSPACE_SKILLS_DIR`
- `robocopy $GLOBAL_SKILLS_DIR $WORKSPACE_SKILLS_DIR /E`

Rules
- Never copy secrets into skills.
- Review each skill for tool access and prompt-injection risks.
- Keep a curated list in `MEMORY.md` if a skill is deprecated.
