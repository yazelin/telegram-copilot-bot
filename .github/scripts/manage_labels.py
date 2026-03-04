#!/usr/bin/env python3
"""Add or remove labels on an issue or PR.
Usage: python manage_labels.py <owner/name> <number> <add|remove> <label>
Env: GH_TOKEN
"""
import json, subprocess, sys

def main():
    if len(sys.argv) < 5:
        print(json.dumps({"ok": False, "error": "Usage: manage_labels.py <owner/name> <number> <add|remove> <label>"}))
        sys.exit(1)
    repo, number, action, label = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
    if action == "add":
        cmd = ["gh", "issue", "edit", number, "--repo", repo, "--add-label", label]
    elif action == "remove":
        cmd = ["gh", "issue", "edit", number, "--repo", repo, "--remove-label", label]
    else:
        print(json.dumps({"ok": False, "error": f"Unknown action: {action}"}))
        sys.exit(1)
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(json.dumps({"ok": False, "error": result.stderr.strip()[-300:]}))
        sys.exit(1)
    print(json.dumps({"ok": True, "action": action, "label": label}))

if __name__ == "__main__":
    main()
