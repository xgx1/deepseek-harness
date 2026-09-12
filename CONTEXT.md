# DeepSeek Harness self-development

Glossary for the dual-instance self-development workflow used to develop DSH while a production instance keeps serving. The concrete, this-host realization (paths, ports, service unit, branch names) lives in [the worktree decision record](.agents/notes/implemented/process/2026-09-08-developer-worktree-non-disruptive-self-development.md) and the `dsh-dev-*` project skills; this file holds only the terms.

## Language

**Production Instance**:
The `dsh web` process serving live agent work; its code comes from the main worktree's built lib and its state is never touched during development.
_Avoid_: 主服务、线上服务

**Dev Instance**:
A second `dsh web` started from the developer worktree with an isolated state directory, used to develop DSH without affecting production.
_Avoid_: 测试服务、staging

**Developer Worktree**:
The separate git worktree holding the `dev` branch where all self-development happens by default; the main worktree is reserved for production.
_Avoid_: dev 目录、副本

**Merge Deploy**:
Shipping verified dev work to production — merge `dev` into `master`, rebuild the main worktree, restart the production service. See `dsh-merge-deploy-master`.
_Avoid_: 发布、上线、deploy

**Hotfix Sync**:
Bringing a production hotfix landed directly on `master` back into `dev` so the branches do not diverge. Inverse of Merge Deploy. See `dsh-master-hotfix-sync`.
_Avoid_: 回滚、revert
