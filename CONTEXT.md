# DeepSeek Harness self-development

Terms for developing DSH on this host, where the main worktree serves production.

## Language

**Production Instance**:
The `dsh web` process serving live agent work; its code comes from this worktree's built lib (`apps/cli/lib/bin.js`, reached through the global `dsh` symlink) and it is managed by the `dsh-web.service` systemd user unit on port 3080 with state `~/.dsh`.
_Avoid_: 主服务、线上服务

**Deploy**:
Shipping verified work to the running production instance — rebuild this worktree, then restart the production service. The restart interrupts the active conversation, so it is user-confirmed work. See `dsh-deploy-master`.
_Avoid_: 发布、上线

## Retired

The dual-instance workflow was retired on 2026-09-13. It comprised a separate `developer` worktree on branch `dev`, a second `dsh web` instance on port 3081 with isolated `DSH_HOME`, and the Merge Deploy / Hotfix Sync procedures that moved work between the branches. DSH self-development now happens directly in this worktree; the setup, its decision record, and its skills were removed, and remain available in git history.
