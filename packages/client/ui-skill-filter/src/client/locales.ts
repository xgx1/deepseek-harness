/** Locale bundles for the skill-filter settings page and Sidebar tab. */

/** Locale keys these surfaces render. */
export type SkillFilterKey =
  | 'nav' | 'title' | 'intro'
  | 'type.label' | 'guide.title' | 'guide.description'
  | 'personal' | 'personal.intro' | 'personal.absent' | 'personal.present'
  | 'personal.error' | 'personal.allow' | 'personal.deny'
  | 'personal.allowHint' | 'personal.denyHint'
  | 'project' | 'project.intro' | 'project.absent' | 'project.present'
  | 'project.error' | 'project.inherits'
  | 'effective' | 'effective.none'
  | 'catalog' | 'catalog.intro' | 'catalog.search' | 'catalog.empty'
  | 'catalog.unavailable' | 'catalog.loadFailed' | 'catalog.retry'
  | 'state.visible' | 'state.hidden'
  | 'action.allow' | 'action.deny' | 'action.clear' | 'action.save' | 'action.saving'
  | 'action.saved' | 'action.saveFailed' | 'action.addPattern'
  | 'prefixes' | 'prefixes.intro' | 'prefixes.empty'

/** English copy. */
export const en: Record<SkillFilterKey, string> = {
  nav: 'Skills',
  title: 'Skill filtering',
  intro: 'Choose which skills the model may see. A skill that is hidden stays callable with /name.',
  'type.label': 'Skills',
  'guide.title': 'Skills',
  'guide.description': 'Review and override which skills the model can see in this project.',
  personal: 'Personal rules',
  'personal.intro': 'Applied to every project. The project rules below replace them when a project config exists.',
  'personal.absent': 'No personal config yet. Add an allow pattern to start filtering.',
  'personal.present': 'Loaded from ~/.dsh/skill-filter.yaml.',
  'personal.error': 'The personal config could not be read; the last valid copy is still in effect.',
  'personal.allow': 'Allowed',
  'personal.deny': 'Denied',
  'personal.allowHint': 'Glob patterns that make matching skills visible. Specific skill names win over globs.',
  'personal.denyHint': 'Glob patterns that hide matching skills. Applied after the allow patterns.',
  project: 'Project rules',
  'project.intro': 'Applied to this project only. When present they replace the personal rules.',
  'project.absent': 'No project config; the personal rules apply.',
  'project.present': 'Loaded from .dsh/skill-filter.yaml in the project root.',
  'project.error': 'The project config could not be read; treat it as absent until it parses.',
  'project.inherits': 'Inherited from personal',
  effective: 'Effective rules',
  'effective.none': 'No personal config, so every skill keeps its own visibility.',
  catalog: 'Skill catalog',
  'catalog.intro': 'Search every skill this session can see and switch it between allowed and denied.',
  'catalog.search': 'Search skills',
  'catalog.empty': 'No skill matches this search.',
  'catalog.unavailable': 'Open a session to list its skills.',
  'catalog.loadFailed': 'The skill catalog could not be loaded.',
  'catalog.retry': 'Retry',
  'state.visible': 'Visible',
  'state.hidden': 'Hidden',
  'action.allow': 'Allow',
  'action.deny': 'Deny',
  'action.clear': 'Clear',
  'action.save': 'Save',
  'action.saving': 'Saving…',
  'action.saved': 'Saved.',
  'action.saveFailed': 'The config was rejected; the previous rules are still in effect.',
  'action.addPattern': 'Add pattern',
  prefixes: 'Suggested groups',
  'prefixes.intro': 'Skill names share a prefix before the first hyphen. Allow a whole group at once.',
  'prefixes.empty': 'No skill is available to group.',
}

/** Chinese copy. */
export const zh: Record<SkillFilterKey, string> = {
  nav: '技能',
  title: '技能过滤',
  intro: '选择模型可以看到哪些技能。被隐藏的技能仍可用 /名称 直接调用。',
  'type.label': '技能',
  'guide.title': '技能',
  'guide.description': '查看并覆盖本项目中对模型可见的技能。',
  personal: '个人规则',
  'personal.intro': '对所有项目生效。存在项目配置时，下面的项目规则会整体替换个人规则。',
  'personal.absent': '还没有个人配置。添加一条允许模式即可开始过滤。',
  'personal.present': '已从 ~/.dsh/skill-filter.yaml 读取。',
  'personal.error': '个人配置读取失败；仍在沿用上一份有效配置。',
  'personal.allow': '允许',
  'personal.deny': '拒绝',
  'personal.allowHint': '让匹配技能对模型可见的通配模式。具体技能名优先于通配模式。',
  'personal.denyHint': '隐藏匹配技能的通配模式，在允许模式之后判定。',
  project: '项目规则',
  'project.intro': '只对当前项目生效。一旦存在，就整体替换个人规则。',
  'project.absent': '没有项目配置，当前沿用个人规则。',
  'project.present': '已从项目根目录 .dsh/skill-filter.yaml 读取。',
  'project.error': '项目配置读取失败；在它能解析之前按缺失处理。',
  'project.inherits': '继承自个人配置',
  effective: '生效规则',
  'effective.none': '没有个人配置，所有技能保持自身声明的可见性。',
  catalog: '技能目录',
  'catalog.intro': '搜索本会话可见的全部技能，并在允许与拒绝之间切换。',
  'catalog.search': '搜索技能',
  'catalog.empty': '没有技能匹配当前搜索。',
  'catalog.unavailable': '打开一个会话后即可查看其技能。',
  'catalog.loadFailed': '技能目录加载失败。',
  'catalog.retry': '重试',
  'state.visible': '可见',
  'state.hidden': '隐藏',
  'action.allow': '允许',
  'action.deny': '拒绝',
  'action.clear': '清除',
  'action.save': '保存',
  'action.saving': '保存中…',
  'action.saved': '已保存。',
  'action.saveFailed': '配置被拒绝；此前的规则仍然生效。',
  'action.addPattern': '添加模式',
  prefixes: '建议分组',
  'prefixes.intro': '技能名在第一个连字符前共享前缀，可以整组放行。',
  'prefixes.empty': '没有可用于分组的技能。',
}
