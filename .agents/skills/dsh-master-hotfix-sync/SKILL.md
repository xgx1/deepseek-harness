---
name: dsh-master-hotfix-sync
description: Sync a production hotfix landed directly on `master` back into the `dev` branch so ongoing dev work does not diverge. Use after a hotfix was committed and deployed on master (via `dsh-merge-deploy-master` or a direct rebuild+restart), before resuming dev work. This host only; see ../../notes/implemented/process/2026-09-08-developer-worktree-non-disruptive-self-development.md.
---

# DSH Master Hotfix Sync

A hotfix sometimes lands on `master` directly (production rebuilt and `dsh-web.service` restarted) without going through `dev`. Bring `dev` back in sync so the next merge carries everything. This is the inverse of `dsh-merge-deploy-master` (which merges `dev` → `master`); run it after a master-side hotfix, not after a normal dev→master merge (the post-merge step there already fast-forwards `dev`).

## Check whether sync is needed

```sh
git -C /home/sx/MyAI/developer fetch
git -C /home/sx/MyAI/developer log --oneline dev..master
```

If the list is empty, `dev` already contains every master commit — stop.

## Merge-forward into dev

```sh
git -C /home/sx/MyAI/developer status --short --branch   # must be clean and on dev
git -C /home/sx/MyAI/developer merge master
```

Resolve conflicts deliberately in `dev`; never force-push or rewrite shared history. Do not `git reset --hard` `dev` onto `master` — that discards dev's own commits.

## Rebuild decision

- **Client-only changes**: the dev watcher rebuilds automatically; verify `3081` still serves the updated bundle after a reload.
- **Host-side or mixed changes**: run the host-side restart cycle from `dsh-dev-loop` — stop the watcher, `pnpm run build`, restart the watcher, restart the dev instance (source-launch mode skips the build).

## Verify

```sh
curl -s -o /dev/null -w "dev  3081: %{http_code}\n" http://127.0.0.1:3081
curl -s -o /dev/null -w "prod 3080: %{http_code}\n" http://127.0.0.1:3080
```

Production must be untouched by this skill; `dev` now contains the hotfix.
