#!/usr/bin/env python3
"""Push initial files to a repository.
Usage: python setup_repo.py <owner/name> <json_files>
Env: GH_TOKEN
"""
import json, os, subprocess, sys, tempfile, time

def main():
    if len(sys.argv) < 3:
        print(json.dumps({"ok": False, "error": "Usage: setup_repo.py <owner/name> <json_files>"}))
        sys.exit(1)
    repo, files = sys.argv[1], json.loads(sys.argv[2])
    with tempfile.TemporaryDirectory() as tmpdir:
        for attempt in range(1, 4):
            result = subprocess.run(["gh", "repo", "clone", repo, tmpdir, "--", "--depth=1"], capture_output=True, text=True)
            if result.returncode == 0:
                break
            if attempt < 3:
                time.sleep(5)
        else:
            print(json.dumps({"ok": False, "error": f"Clone failed: {result.stderr.strip()[-300:]}"}))
            sys.exit(1)
        for f in files:
            filepath = os.path.join(tmpdir, f["path"])
            os.makedirs(os.path.dirname(filepath), exist_ok=True)
            with open(filepath, "w") as fh:
                fh.write(f["content"])
        token = os.environ.get("GH_TOKEN", "")
        subprocess.run(["git", "remote", "set-url", "origin", f"https://x-access-token:{token}@github.com/{repo}.git"], cwd=tmpdir, capture_output=True)
        subprocess.run(["git", "config", "user.name", "github-actions[bot]"], cwd=tmpdir, capture_output=True)
        subprocess.run(["git", "config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"], cwd=tmpdir, capture_output=True)
        branch_result = subprocess.run(["git", "rev-parse", "--abbrev-ref", "HEAD"], cwd=tmpdir, capture_output=True, text=True)
        default_branch = branch_result.stdout.strip() or "main"
        subprocess.run(["git", "add", "-A"], cwd=tmpdir, capture_output=True)
        subprocess.run(["git", "commit", "-m", "Initial commit: project setup"], cwd=tmpdir, capture_output=True)
        result = subprocess.run(["git", "push", "origin", default_branch], cwd=tmpdir, capture_output=True, text=True)
        if result.returncode != 0:
            print(json.dumps({"ok": False, "error": f"Push failed: {result.stderr.strip()[-300:]}"}))
            sys.exit(1)
    result = subprocess.run(
        ["gh", "api", f"repos/{repo}/pages", "-X", "POST", "-f", "build_type=legacy", "-f", f"source[branch]={default_branch}", "-f", "source[path]=/"],
        capture_output=True, text=True)
    print(json.dumps({"ok": True, "files_pushed": len(files), "pages_enabled": result.returncode == 0}))

if __name__ == "__main__":
    main()
