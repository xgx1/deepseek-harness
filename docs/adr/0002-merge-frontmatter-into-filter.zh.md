# 把技能的 frontmatter 拒绝并入过滤引擎

[English](0002-merge-frontmatter-into-filter.md) | 中文

技能自身的 `disable-model-invocation: true` frontmatter 被视为来自该技能的隐式拒绝规则。过滤引擎把它与个人配置、项目配置合并。优先级：项目配置 > 个人配置 > 技能自身 frontmatter 拒绝。

## 考虑过的方案

- **各层独立**：frontmatter 拒绝是硬阻断，与过滤器分离。用户的 `allow: ["dotnet-*"]` 无法覆盖带 `disable-model-invocation: true` 的技能。这迫使用户为了覆盖作者意图去改技能源文件——违背「在界面里配置」的目标。
- **替换 frontmatter**：彻底去掉 `disable-model-invocation`，把所有控制权交给过滤器。这是破坏性变更：每个带该 frontmatter 的技能都需要迁移，技能作者也失去了「默认请隐藏我」的表达手段。
- **合并（选定）**：frontmatter 拒绝是最弱规则。作者意图作为默认值被保留，但用户配置可以覆盖它。技能作者的 `disable-model-invocation: true` 说的是「我认为这该被隐藏」——用户的 `allow` 说的是「我不同意，显示它」。

## 后果

- 带 `disable-model-invocation: true` 的技能默认隐藏（与当前行为一致），但用户可以添加允许规则来覆盖。这保持了向后兼容。
- 过滤引擎必须区分规则来源（技能自身、个人、项目）以应用正确的优先级。`dsh-skill` 的 `SkillSource` 类型已经记录了来源。
- 如果某技能在将来的更新里去掉 `disable-model-invocation`，它会自动变为可见（只要匹配某条允许规则）——无需用户操作。
