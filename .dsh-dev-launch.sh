#!/usr/bin/env bash
# dev 实例启动脚本（双实例自举开发约定，见 .agents/notes/implemented/process/
# 2026-09-08-developer-worktree-non-disruptive-self-development.md 与
# .agents/skills/dsh-dev-loop/SKILL.md）
set -e
source "$HOME/.dsh/dsh-env.sh"
export PATH="$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin"
export DSH_HOME="/home/sx/projects/MyAI/dev/.dsh-home"
cd /home/sx/projects/MyAI/dev
exec node --import tsx/esm apps/cli/src/bin.ts web --port 3081 --no-open