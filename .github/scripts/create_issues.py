#!/usr/bin/env python3
"""Create multiple issues in a repository.
Usage: python create_issues.py <owner/name> <json_issues>
Env: GH_TOKEN
"""
import json, subprocess, sys

def main():
    if len(sys.argv) < 3:
        print(json.dumps({"ok": False, "error": "Usage: create_issues.py <owner/name> <json_issues>"}))
        sys.exit(1)
    repo, issues = sys.argv[1], json.loads(sys.argv[2])
    numbers = []
    for label, desc, color in [
        ("copilot-task", "Managed by Copilot agent", "0E8A16"),
        ("agent-stuck", "Agent could not complete this issue", "D93F0B"),
        ("needs-human-review", "Needs human intervention", "FBCA04"),
    ]:
        subprocess.run(["gh", "label", "create", label, "--repo", repo, "--description", desc, "--color", color], capture_output=True, text=True)
    for issue in issues:
        result = subprocess.run(
            ["gh", "issue", "create", "--repo", repo, "--title", issue["title"], "--body", issue["body"], "--label", "copilot-task"],
            capture_output=True, text=True)
        if result.returncode != 0:
            print(json.dumps({"ok": False, "error": f"Failed to create '{issue['title']}': {result.stderr.strip()[-300:]}"}))
            sys.exit(1)
        url = result.stdout.strip()
        numbers.append(int(url.rstrip("/").split("/")[-1]))
    print(json.dumps({"ok": True, "issues_created": len(numbers), "numbers": numbers}))

if __name__ == "__main__":
    main()
