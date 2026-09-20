# Merge skill frontmatter deny into the filter engine

English | [中文](0002-merge-frontmatter-into-filter.zh.md)

A skill's `disable-model-invocation: true` frontmatter is treated as an implicit deny rule from the skill itself. The filter engine merges it with personal and project config. Precedence: project config > personal config > skill's own frontmatter deny.

## Considered Options

- **Independent layers**: frontmatter deny is a hard block, separate from the filter. A user's `allow: ["dotnet-*"]` cannot override a skill that has `disable-model-invocation: true`. This forces users to edit skill source files to override author intent — breaks the "configure in UI" goal.
- **Replace frontmatter**: drop `disable-model-invocation` entirely, move all control to the filter. Breaking change: every skill with that frontmatter needs migration, and skill authors lose their ability to signal "please hide me" by default.
- **Merge (chosen)**: frontmatter deny is the weakest rule. Author intent is preserved as the default, but user config overrides it. The skill author's `disable-model-invocation: true` says "I think this should be hidden" — the user's `allow` says "I disagree, show it."

## Consequences

- Skills with `disable-model-invocation: true` are hidden by default (matching current behavior), but users can override by adding an allow rule. This preserves backward compatibility.
- The filter engine must distinguish rule sources (skill-own, personal, project) to apply correct precedence. The `SkillSource` type from `dsh-skill` already tracks origin.
- If a skill removes `disable-model-invocation` in a future update, it becomes visible automatically (if an allow rule matches) — no user action needed.