# DeepSeek Harness self-development

Terms for developing DSH on this host, where the main worktree serves production.

## Language

**Production Instance**:
The `dsh web` process serving live agent work; its code comes from this worktree's built lib (`apps/cli/lib/bin.js`, reached through the global `dsh` symlink) and it is managed by the `dsh-web.service` systemd user unit on port 3080 with state `~/.dsh`.
_Avoid_: 主服务、线上服务

**Deploy**:
Shipping verified work to the running production instance — rebuild this worktree, then restart the production service. The restart interrupts the active conversation, so it is user-confirmed work. See `dsh-deploy-master`.
_Avoid_: 发布、上线

## This host

**Self-development checkout**:
This worktree (directory `deepseek-harness`, branch `master` — the directory was renamed from `master` on 2026-09-13); the separate `developer` worktree and its 3081 dev instance were retired on 2026-09-13.
_Avoid_: dev worktree、dev 分支

**Production restart**:
The `dsh` symlink and `dsh-web.service` (port 3080, state `~/.dsh`) serve production from this worktree, so editing changes what production loads at its next restart — which interrupts the active conversation. Confirm before restarting; procedure in `dsh-deploy-master`.
_Avoid_: 重载、热更新

## Skill filtering

**Skill Filter Plugin**:
`dsh-skill-filter` hides denied skills from the model catalog while keeping them `/name`-callable (ADR-0001, ADR-0002).
_Avoid_: 技能过滤、技能白名单

**Skill Filter Config**:
`~/.dsh/skill-filter.yaml` (personal) and `<cwd>/.dsh/skill-filter.yaml` (project overrides personal); required `allow`, optional `deny`, specific names beat globs.
_Avoid_: 技能配置、过滤配置

## Retired

The dual-instance workflow — a separate `developer` worktree, a 3081 dev instance, and the Merge Deploy / Hotfix Sync procedures — was retired on 2026-09-13 and remains only in git history.
