#!/usr/bin/env python3
"""Set secrets on a repository.
Usage: python setup_secrets.py <owner/name> <json_secrets>
Env: GH_TOKEN, COPILOT_TOKEN_VALUE, COPILOT_PAT_VALUE, NOTIFY_TOKEN_VALUE
"""
import json, os, subprocess, sys

def main():
    if len(sys.argv) < 3:
        print(json.dumps({"ok": False, "error": "Usage: setup_secrets.py <owner/name> <json_secrets>"}))
        sys.exit(1)
    repo, secrets = sys.argv[1], json.loads(sys.argv[2])
    for env_key, secret_name in [
        ("COPILOT_TOKEN_VALUE", "COPILOT_GITHUB_TOKEN"),
        ("COPILOT_PAT_VALUE", "COPILOT_PAT"),
        ("NOTIFY_TOKEN_VALUE", "NOTIFY_TOKEN"),
    ]:
        val = os.environ.get(env_key, "")
        if val:
            secrets.append({"name": secret_name, "value": val})
    for s in secrets:
        result = subprocess.run(["gh", "secret", "set", s["name"], "--repo", repo, "--body", s["value"]], capture_output=True, text=True)
        if result.returncode != 0:
            print(json.dumps({"ok": False, "error": f"Failed to set {s['name']}: {result.stderr.strip()[-300:]}"}))
            sys.exit(1)
    print(json.dumps({"ok": True, "secrets_set": len(secrets)}))

if __name__ == "__main__":
    main()
