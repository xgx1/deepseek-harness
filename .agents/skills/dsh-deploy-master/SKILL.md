---
name: dsh-deploy-master
description: Rebuild this worktree and restart the systemd-managed production `dsh web` service on port 3080. Use when verified work is ready to ship to the running production instance without disturbing in-flight agent work more than the brief restart window. This host only.
---

# DSH Deploy to Production

Ship verified work to the running production instance. The production process is `dsh-web.service` (systemd user unit) executing `~/.dsh/dsh-web-launch.sh`, which runs the global `dsh` symlink → this worktree's built `apps/cli/lib/bin.js` on port 3080, state `~/.dsh`.

Self-development happens in this same worktree, so there is no branch to merge: the deploy is a rebuild plus a restart.

## Preflight

1. Confirm the worktree is clean and on `master`. Commit before deploying — the rebuild ships whatever is in the tree.

```sh
git -C /home/sx/projects/MyAI/deepseek-harness status --short --branch
```

2. Confirm production is healthy. **The restart interrupts the active conversation**, so confirm with the user before running it.

```sh
systemctl --user is-active dsh-web
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3080
```

## Rebuild (safe while production runs)

The running process keeps its already-loaded modules in memory, so rebuilding files under it does not affect live sessions — only the restart swaps the code. The global `dsh` symlink already points here, so no re-linking is needed.

```sh
pnpm -C /home/sx/projects/MyAI/deepseek-harness install --frozen-lockfile   # only if pnpm-lock.yaml changed
pnpm -C /home/sx/projects/MyAI/deepseek-harness run build
```

## Restart

The only step that interrupts production (a few seconds).

```sh
systemctl --user restart dsh-web
```

## Verify

```sh
systemctl --user is-active dsh-web
ss -tlnp | grep ':3080'
curl -s -o /dev/null -w "prod 3080: %{http_code}\n" http://127.0.0.1:3080
```

Production must return 200.

## Caveats

- **The restart ends the conversation that asked for it.** Never run it without the user's confirmation.
- **Downtime = the restart only.** Rebuild with the old process alive, then restart to minimize the window.
- **Do not push without the user's explicit go-ahead**; this skill operates locally.
