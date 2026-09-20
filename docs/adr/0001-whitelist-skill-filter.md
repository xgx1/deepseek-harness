# Whitelist skill filtering model

English | [中文](0001-whitelist-skill-filter.zh.md)

Skill visibility defaults to denied. A skill appears in the model's `<available_skills>` catalog only when an allow rule matches it. This is the opposite of every other major agent framework (Claude Code, Cursor, VS Code), which defaults to "all visible."

## Considered Options

- **Blacklist (default allow, user denies)**: Matches industry convention. But with 300+ installed skills, the agent catalog is bloated from day one and users must deny each unrelated skill individually. The "import current catalog, then deny" flow is essentially a whitelist with extra steps.
- **Whitelist (default deny, user allows)**: Forces conscious curation. Users batch-allow by prefix (`dotnet-*`, `self-*`) and the catalog stays lean. The UX cost is real (first-run setup), but the 25KB → 2KB savings per turn compound across every session.
- **Category presets**: Ship curated allow-lists per project type. Deferred: too opinionated, users need per-skill control anyway.

## Consequences

- First-time users see an empty catalog until they configure allow rules. The UI mitigates this by pre-importing the current catalog as allowed, then letting users batch-deny by prefix.
- New skills from DSH updates auto-match existing allow globs. A skill not matching any allow rule is invisible until the user acts — this is by design, not a bug.
- The `disable-model-invocation` frontmatter is subsumed into this system (see ADR-0002).