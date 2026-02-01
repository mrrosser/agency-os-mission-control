import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def test_openclaw_template_keys():
    data = load_json(ROOT / "config-templates" / "openclaw.json.template")
    assert "agents" in data
    assert data["agents"].get("defaults", {}).get("workspace")
    assert "logging" in data
    assert "tools" in data
    assert "channels" in data
    assert "googlechat" in data["channels"]
    assert "telegram" in data["channels"]
    assert "plugins" in data
    assert "entries" in data["plugins"]
    assert "voice-call" in data["plugins"]["entries"]


def test_exec_approvals_templates():
    gw = load_json(ROOT / "config-templates" / "exec-approvals.gateway.json")
    node = load_json(ROOT / "config-templates" / "exec-approvals.node.json")
    assert gw.get("allow")
    assert node.get("allow")


if __name__ == "__main__":
    test_openclaw_template_keys()
    test_exec_approvals_templates()
    print("OK")
