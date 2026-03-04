#!/usr/bin/env python3
"""Trigger a workflow in a repository.
Usage: python trigger_workflow.py <owner/name> <workflow_file>
Env: GH_TOKEN
"""
import json, subprocess, sys

def main():
    if len(sys.argv) < 3:
        print(json.dumps({"ok": False, "error": "Usage: trigger_workflow.py <owner/name> <workflow_file>"}))
        sys.exit(1)
    repo, workflow = sys.argv[1], sys.argv[2]
    result = subprocess.run(["gh", "workflow", "run", workflow, "--repo", repo], capture_output=True, text=True)
    if result.returncode != 0:
        print(json.dumps({"ok": False, "error": result.stderr.strip()[-500:]}))
        sys.exit(1)
    print(json.dumps({"ok": True, "repo": repo, "workflow": workflow}))

if __name__ == "__main__":
    main()
