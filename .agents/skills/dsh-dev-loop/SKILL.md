---
name: dsh-dev-loop
description: Day-to-day operating rules for self-developing DSH in the `developer` worktree (branch `dev`) without disturbing the running production instance on 3080. Use when changing DSH source, restarting the dev instance on 3081, hot-reloading browser changes, or handling host-side versus client-side edits. This host only; the dual-instance invariant lives in ../../notes/implemented/process/2026-09-08-developer-worktree-non-disruptive-self-development.md.
---

# DSH Dev Loop

Develop DSH itself here, never in the main worktree. Two instances run on one host:

- **Production**: main worktree `/home/sx/MyAI/deepseek-harness` (branch `master`), `dsh-web.service` (systemd user unit) on `3080`, state `~/.dsh`. Do not touch during dev.
- **Dev**: worktree `/home/sx/MyAI/developer` (branch `dev`), port `3081`, isolated `DSH_HOME=/home/sx/MyAI/developer/.dsh-home`, reusing the same API key via `source ~/.dsh/dsh-env.sh`.

The global `dsh` symlink points at the main worktree's built `apps/cli/lib/bin.js`, so editing there would change production on its next restart — edit only in the dev worktree.

## Liveness checks

```sh
ss -tlnp | grep -E ':3080|:3081'
pgrep -af 'scripts/dev-web'        # the watcher (pnpm dev:web)
```

## Client-side (browser) changes

Nothing to do. `pnpm dev:web` watches source and rebuilds `lib/client.js`, `lib/types`, and `apps/web/dist`; the dev `dsh web` stat-polls those artifacts and broadcasts `rebuilt` to the browser, which hot-reloads. The watcher covers only the client preset; it does not watch host packages.

## Host-side (server) changes

Host source is not watched and the dev instance serves compiled artifacts, so host changes need a dev-instance restart — the question is whether a rebuild is needed first.

- **Source-launch mode (preferred for host-heavy iteration)**: run the dev instance from source via tsx, so a restart picks up fresh source without any build.

  ```sh
  cd /home/sx/MyAI/developer
  source ~/.dsh/dsh-env.sh
  export DSH_HOME=/home/sx/MyAI/developer/.dsh-home
  exec node --import tsx/esm apps/cli/src/bin.ts web --port 3081 --no-open
  ```

  (`pnpm dsh web --port 3081 --no-open` is equivalent.) After host edits, restart only this process; the watcher keeps serving client bundles. Start cost is higher (tsx transpiles on demand).

- **Built-lib mode**: the dev instance runs `node apps/cli/lib/bin.js`. Host edits need `pnpm run build` first — and the watcher MUST be stopped for it, since both write the same `lib/` and `apps/web/dist` trees. Full cycle: stop watcher → `pnpm run build` → restart watcher → restart dev instance.

## Restart (durable, works across sessions)

Find and stop:

```sh
ss -tlnp | grep ':3081'            # dev instance PID
pgrep -af 'scripts/dev-web'       # watcher PID
# kill those PIDs
```

Start watcher and dev instance as background processes (or via the harness background-job tool in-session):

```sh
cd /home/sx/MyAI/developer && pnpm dev:web
cd /home/sx/MyAI/developer && source ~/.dsh/dsh-env.sh \
  && export DSH_HOME=/home/sx/MyAI/developer/.dsh-home \
  && exec node --import tsx/esm apps/cli/src/bin.ts web --port 3081 --no-open
```

Verify:

```sh
curl -s -o /dev/null -w "dev  3081: %{http_code}\n" http://127.0.0.1:3081
curl -s -o /dev/null -w "prod 3080: %{http_code}\n" http://127.0.0.1:3080
```

## Rules

- Edit only in `/home/sx/MyAI/developer`; the main worktree is production's code source.
- Never run `pnpm run build` in the dev worktree while the watcher is running.
- Restarting the dev instance never affects production; the only step that touches production is `systemctl --user restart dsh-web`, and that lives in `dsh-merge-deploy-master`.
- Cross-session process logs are not retained unless redirected; rely on liveness checks and clean restarts.
