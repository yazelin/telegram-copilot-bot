#!/usr/bin/env python3
"""Create a GitHub repository.
Usage: python create_repo.py <owner/name> <description>
Env: GH_TOKEN
"""
import json, subprocess, sys

def main():
    if len(sys.argv) < 3:
        print(json.dumps({"ok": False, "error": "Usage: create_repo.py <owner/name> <description>"}))
        sys.exit(1)
    repo, description = sys.argv[1], sys.argv[2]
    result = subprocess.run(
        ["gh", "repo", "create", repo, "--public", "--description", description, "--clone=false"],
        capture_output=True, text=True)
    if result.returncode != 0:
        print(json.dumps({"ok": False, "error": result.stderr.strip()[-500:]}))
        sys.exit(1)
    print(json.dumps({"ok": True, "repo": repo, "url": result.stdout.strip()}))

if __name__ == "__main__":
    main()
