# Agent Note: 修复悬空的 profile 模块后备投影链接

Status: implemented

[English](2026-09-12-heal-dangling-profile-projection-links.md) | 中文

## 问题

profile 目录被复制或迁移到其他路径后，其模块后备的绝对链接仍然保留：`<profile>/node_modules` 下的投影仍指向旧的 `<old-profile>/.dsh-module-fallback/node_modules/<package>`。旧目录一旦消失，所有投影都会悬空，仅由所选 bundle 携带的包无法解析；共享的 [`profiles/node_modules`](../../../../packages/boot/app-boot/README.zh.md) 后备只覆盖安装闭包。此前的 `ensureProfileSymlink` 把任何已存在的目录条目都当作权威（`lstat` 成功即提前返回），因此启动时从不会修复；`removeProfileSymlink` 也只在投影仍指向当前 owned 链接时才删除，过期投影因此残留。

## 决策

[`ensureProfileSymlink`](../../../../packages/boot/app-boot/src/profile.ts) 检查已有条目：非符号链接保持不动（pnpm 管理的条目优先）；只有 dsh 自有的符号链接——目标包含 `/.dsh-module-fallback/node_modules/`——且尚未指向请求的 owned 链接才重建。外部用户符号链接保持不动。[`removeProfileSymlink`](../../../../packages/boot/app-boot/src/profile.ts) 在投影指向当前 owned 链接、或本身是悬空的 dsh 自有投影时将其删除，使已迁移 profile 的过期投影随其 owned 目标一起消失。`isModuleFallbackTarget` 从链接文本读取所有权特征，并归一化 Windows 分隔符。

## 已考虑的替代方案

**修复所有目标无法解析的符号链接。** 未采用：用户自管的悬空符号链接不是 dsh 的条目，重写会静默改变外部包的指向。

**依赖共享的 `profiles/node_modules` 修复。** 未采用：该轮修复只处理当前安装闭包中的包名，不包含投影进单个 profile 的 bundle-only 包。

**在发现阶段删除任何指向 `.dsh-module-fallback` 路径的符号链接。** 未采用：所有权必须在包离开 bundle 闭包后的调和路径中判断，而不是在重算闭包时。

## 后果

profile 复制或迁移后的启动会重新指向悬空投影并移除过期的自有投影；外部条目仍然优先。共享的 `profiles/node_modules` 后备仍不会清理已离开安装闭包但可解析的条目，因为该目录可服务多个安装；过期的共享链接会保留，直到后续某代安装重新使用该名称。

## 测试

[profile 测试](../../../../packages/boot/app-boot/tests/profile.spec.ts) 覆盖：复制后的 profile 投影被修复、外部符号链接被保留、pnpm 管理的目录被保留、过期悬空投影被移除。`packages/boot/app-boot/src/profile.ts` 的语句、分支、函数与行覆盖率保持 100%。
