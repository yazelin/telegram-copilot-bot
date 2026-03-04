#!/usr/bin/env python3
"""Fork a GitHub repository.
Usage: python fork_repo.py <source_repo> <target_org> [fork_name]
Env: GH_TOKEN
"""
import json, subprocess, sys, time

def main():
    if len(sys.argv) < 3:
        print(json.dumps({"ok": False, "error": "Usage: fork_repo.py <source_repo> <target_org> [fork_name]"}))
        sys.exit(1)
    source_repo, target_org = sys.argv[1], sys.argv[2]
    fork_name = sys.argv[3] if len(sys.argv) > 3 else None
    cmd = ["gh", "repo", "fork", source_repo, "--org", target_org, "--clone=false"]
    if fork_name:
        cmd.extend(["--fork-name", fork_name])
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(json.dumps({"ok": False, "error": result.stderr.strip()[-500:]}))
        sys.exit(1)
    name = fork_name if fork_name else source_repo.split("/")[-1]
    repo = f"{target_org}/{name}"
    for i in range(6):
        check = subprocess.run(["gh", "repo", "view", repo, "--json", "name"], capture_output=True, text=True)
        if check.returncode == 0:
            break
        time.sleep(5)
    subprocess.run(["gh", "api", f"repos/{repo}", "-X", "PATCH", "-f", "has_issues=true"], capture_output=True, text=True)
    print(json.dumps({"ok": True, "repo": repo, "url": f"https://github.com/{repo}"}))

if __name__ == "__main__":
    main()
