import subprocess
import sys

def git(*args, check=True): # Run a git command; returns its output
    result = subprocess.run(["git", *args], capture_output=True, text=True)
    if check and result.returncode:
        sys.exit(f"git {' '.join(args)} failed:\n  {result.stderr.strip()}")
    return result.stdout.strip()

def confirm(question): # Stop unless the answer is "yes"
    if input(f"{question} [yes/N]: ").strip().lower() != "yes":
        sys.exit("Stopped, nothing was changed.")

def main():
    root = git("rev-parse", "--show-toplevel", check=False)
    if not root:
        sys.exit("This isn't inside a git repository.")
    run = lambda *args, **kw: git("-C", root, *args, **kw) # Every command runs at the repo root
    branch, remote = run("rev-parse", "--abbrev-ref", "HEAD"), (run("remote").splitlines() or [None])[0]
    if branch == "HEAD":
        sys.exit("No branch is checked out (detached HEAD). Check out your main branch first.")
    if remote:
        run("fetch", "--prune", remote, check=False) # Up-to-date list of its branches
    others = [b for b in run("branch", "--format=%(refname:short)").splitlines() if b != branch]
    remote_others = [b.split("/", 1)[1] for b in run("branch", "-r", "--format=%(refname:short)").splitlines()
                     if remote and b.startswith(f"{remote}/") and b.split("/", 1)[1] not in (branch, "HEAD")] if remote else []
    changes = run("status", "--porcelain")

    print(f"Repository: {root}\nBranch:     {branch}\nRemote:     {remote or 'none (local only)'}")
    if changes:
        print(f"\nUncommitted changes (these go into the new commit too):\n{changes}")
    print("\nThis will:\n  1. Replace ALL history with a single 'Initial commit' of the files as they are now")
    if others:
        print(f"  2. Delete the other local branches: {', '.join(others)}")
    if remote:
        print(f"  3. Force-push to {remote}/{branch}" + (f" and delete {remote}'s other branches: {', '.join(remote_others)}" if remote_others else ""))
    print("\nThis CANNOT be undone.")
    confirm("Type 'yes' to go ahead")

    # Rewrite
    run("checkout", "--orphan", "_squash") # New branch with no history, same files
    run("add", "-A")
    run("commit", "-m", "Initial commit")
    run("branch", "-D", branch)
    run("branch", "-m", branch)
    for b in others:
        run("branch", "-D", b, check=False)
    run("reflog", "expire", "--expire=now", "--all") # Let git forget the old commits...
    run("gc", "--prune=now", "--quiet") # ...and free their space
    print(f"\nHistory replaced: '{branch}' is now one commit.")

    # Publish
    if remote:
        print(f"Force-pushing to {remote}/{branch} ...")
        result = subprocess.run(["git", "-C", root, "push", "--force", "-u", remote, branch], capture_output=True, text=True)
        if result.returncode:
            sys.exit(f"Push failed:\n  {result.stderr.strip()}\nTry it yourself: git push --force -u {remote} {branch}")
        for b in remote_others:
            run("push", remote, "--delete", b, check=False)
        run("fetch", "--prune", remote, check=False)
        print("Pushed. GitHub Pages republishes in a minute or two.")
    print(f"\nLog:\n  {run('log', '--oneline')}")

if __name__ == "__main__":
    main()