---
name: dsh-merge-deploy-master
description: Merge the `dev` worktree branch into `master`, rebuild the main worktree, and restart the systemd-managed production `dsh web` service on port 3080. Use when development on the `dev` branch is verified and ready to ship to the running production instance without disturbing in-flight agent work more than the brief restart window. This host only; the dual-instance invariant lives in ../../notes/implemented/process/2026-09-08-developer-worktree-non-disruptive-self-development.md.
---

# DSH Merge Deploy to Master

Ship verified `dev` work to the running production instance. The production process is `dsh-web.service` (systemd user unit) executing `~/.dsh/dsh-web-launch.sh`, which runs the global `dsh` symlink → the main worktree's built `apps/cli/lib/bin.js` on port 3080, state `~/.dsh`. The dev instance on 3081 (isolated `DSH_HOME=/home/sx/projects/MyAI/dev/.dsh-home`) is independent and must keep running through this deploy.

Paths below are this-machine-specific; the invariant (separate worktrees, isolated `DSH_HOME`, `dsh` symlink → main worktree lib) is in the [worktree decision record](../../notes/implemented/process/2026-09-08-developer-worktree-non-disruptive-self-development.md).

## Preflight

1. Confirm the dev worktree is clean and on `dev`.

```sh
git -C /home/sx/projects/MyAI/dev status --short --branch
```

If anything is uncommitted, commit it first — a merge deploys only committed history.

2. Confirm production is healthy and pick a moment with no long-running agent task on 3080 (the only step that interrupts it is the final restart).

```sh
systemctl --user is-active dsh-web
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3080
```

## Merge

Merge `dev` into `master` in the **main worktree** as a merge commit (not fast-forward), so the dev history stays traceable.

```sh
git -C /home/sx/projects/MyAI/master merge --no-ff dev
```

## Rebuild (main worktree, safe while production runs)

The running process keeps its already-loaded modules in memory, so rebuilding files under it does not affect live sessions — only the restart swaps the code. The global `dsh` symlink already points here, so no re-linking is needed.

```sh
pnpm -C /home/sx/projects/MyAI/master install --frozen-lockfile   # only if pnpm-lock.yaml changed
pnpm -C /home/sx/projects/MyAI/master run build
```

## Deploy

Restart the systemd unit. This is the only step that interrupts production (a few seconds).

```sh
systemctl --user restart dsh-web
```

## Verify

```sh
systemctl --user is-active dsh-web
ss -tlnp | grep ':3080'
curl -s -o /dev/null -w "prod 3080: %{http_code}\n" http://127.0.0.1:3080
curl -s -o /dev/null -w "dev  3081: %{http_code}\n" http://127.0.0.1:3081
```

Production must return 200; the dev instance must be untouched.

## Post-merge: sync dev to the new master

Bring the dev branch back in sync with master so future work builds on the shipped code.

```sh
git -C /home/sx/projects/MyAI/dev merge --ff-only master
```

If it cannot fast-forward (master diverged in a way dev doesn't have), stop and reconcile deliberately rather than forcing.

## Caveats

- **Never run `pnpm run build` in the dev worktree while `pnpm dev:web` is watching** — both write the same `lib/` and `apps/web/dist` trees and corrupt each other. The build above runs in the main worktree, so the dev watcher is unaffected.
- **Host-side code changes are not hot-reloaded** by the dev watcher; that only covers browser-facing bundles. Restart the dev instance (`bash-7`) after host changes in the dev worktree — production is never affected by dev-instance restarts.
- **Downtime = the restart only.** Rebuild with the old process alive, then restart to minimize the window.
- **Do not push without the user's explicit go-ahead**; this skill operates locally.
