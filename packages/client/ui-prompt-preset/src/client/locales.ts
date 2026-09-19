/** Every product-visible string the prompt-preset surfaces render. */

/** One key of the `settings.promptPreset` dictionary. */
export type PromptPresetKey =
  // section chrome
  | 'nav' | 'intro' | 'error' | 'retry' | 'unavailable'
  // roster
  | 'presetsHeading' | 'newPreset' | 'builtIn' | 'defaultTag' | 'setDefault'
  | 'deletePreset' | 'ruleCount' | 'rosterEmpty' | 'noDescription'
  // create dialog
  | 'createTitle' | 'createIntro' | 'presetId' | 'presetIdPlaceholder'
  | 'displayName' | 'displayNamePlaceholder' | 'create' | 'creating' | 'cancel'
  | 'idRequired' | 'idInvalid' | 'idTaken'
  // editor
  | 'presetName' | 'presetNamePlaceholder' | 'presetDescription'
  | 'presetDescriptionPlaceholder' | 'rulesHeading' | 'rulesEmpty' | 'addRule'
  | 'save' | 'saving' | 'discard' | 'saveBlocked' | 'editorEmpty'
  | 'unsavedTitle' | 'unsavedDescription' | 'unsavedDiscard' | 'unsavedKeep'
  | 'deleteTitle' | 'deleteDescription' | 'deleteConfirm' | 'deleting'
  // rule kinds
  | 'rule.prepend.name' | 'rule.prepend.hint'
  | 'rule.append.name' | 'rule.append.hint'
  | 'rule.insert.name' | 'rule.insert.hint'
  | 'rule.replace.name' | 'rule.replace.hint'
  | 'rule.remove.name' | 'rule.remove.hint'
  | 'rule.substitute.name' | 'rule.substitute.hint'
  // rule fields and controls
  | 'rule.field.text' | 'rule.field.textPlaceholder' | 'rule.field.interpolate'
  | 'rule.field.sections' | 'rule.field.sectionsAll' | 'rule.field.sectionsPlaceholder'
  | 'rule.field.after' | 'rule.field.afterPlaceholder'
  | 'rule.field.pattern' | 'rule.field.patternPlaceholder' | 'rule.field.flags'
  | 'rule.field.replacement' | 'rule.field.replacementPlaceholder'
  | 'rule.enabled' | 'rule.moveUp' | 'rule.moveDown' | 'rule.delete'
  | 'rule.badge.disabled' | 'rule.badge.invalid' | 'rule.badge.shadowed'
  // rule validation
  | 'rule.error.textRequired' | 'rule.error.sectionsRequired'
  | 'rule.error.anchorRequired'
  | 'rule.error.patternRequired' | 'rule.error.flagsInvalid'
  | 'rule.error.patternSyntax' | 'rule.error.replaceDuplicate'
  // preview
  | 'preview.heading' | 'preview.sections' | 'preview.prompt' | 'preview.loading'
  | 'preview.error' | 'preview.empty' | 'preview.needsSession' | 'preview.refresh'
  | 'preview.tag.added' | 'preview.tag.removed' | 'preview.tag.changed'
  | 'preview.tag.protected'
  | 'preview.warn.invalidPattern' | 'preview.warn.patternTooLong'
  | 'preview.warn.unknownSection' | 'preview.warn.noMatch'
  | 'preview.warn.protectedKept' | 'preview.warn.completeOverridden'
  | 'preview.warn.renderFailed' | 'preview.warn.unknownPreset'
  | 'preview.warn.emptyPrompt' | 'preview.warn.unknown'
  // seat
  | 'seat.label' | 'seat.none' | 'seat.hint' | 'seat.appliesNextTurn'
  | 'seat.switchFailed' | 'seat.manage'

/** English copy. */
export const en: Record<PromptPresetKey, string> = {
  nav: 'Prompt presets',
  intro:
    'A prompt preset is an ordered stack of rules applied to the system prompt a task assembles: '
    + 'text added before or after it, a complete replacement, sections removed by name, and find-and-replace '
    + 'over what remains. Pick one from the task screen at any time.',
  error: 'Something went wrong: {message}',
  retry: 'Try again',
  unavailable: 'This deployment stores no prompt presets.',

  presetsHeading: 'Presets',
  newPreset: 'New preset',
  builtIn: 'Built-in',
  defaultTag: 'Default',
  setDefault: 'Use by default',
  deletePreset: 'Delete',
  ruleCount: '{count} rules',
  rosterEmpty: 'No presets yet.',
  noDescription: 'No description',

  createTitle: 'New prompt preset',
  createIntro: 'The id becomes the preset’s storage key and cannot change later.',
  presetId: 'Id',
  presetIdPlaceholder: 'terse',
  displayName: 'Name',
  displayNamePlaceholder: 'Terse',
  create: 'Create',
  creating: 'Creating…',
  cancel: 'Cancel',
  idRequired: 'Give the preset an id.',
  idInvalid: 'Use lowercase letters, digits, and hyphens, starting with a letter or digit.',
  idTaken: 'That id is already taken.',

  presetName: 'Name',
  presetNamePlaceholder: 'Terse',
  presetDescription: 'Description',
  presetDescriptionPlaceholder: 'Short answers, no preamble.',
  rulesHeading: 'Rules',
  rulesEmpty: 'No rules yet. Add one to start shaping the prompt.',
  addRule: 'Add rule',
  save: 'Save',
  saving: 'Saving…',
  discard: 'Discard',
  saveBlocked: 'Fix the highlighted rule before saving.',
  editorEmpty: 'Select a preset to edit it.',
  unsavedTitle: 'Discard unsaved changes?',
  unsavedDescription: 'This preset has edits that were never saved. Leaving loses them.',
  unsavedDiscard: 'Discard',
  unsavedKeep: 'Keep editing',
  deleteTitle: 'Delete this preset?',
  deleteDescription: 'Tasks already running under it keep running; nothing else changes.',
  deleteConfirm: 'Delete',
  deleting: 'Deleting…',

  'rule.prepend.name': 'Add before',
  'rule.prepend.hint': 'Insert text ahead of every existing section.',
  'rule.append.name': 'Add after',
  'rule.append.hint': 'Insert text after every existing section.',
  'rule.insert.name': 'Add after a section',
  'rule.insert.hint': 'Insert text directly behind one named section.',
  'rule.replace.name': 'Replace everything',
  'rule.replace.hint': 'Use this text as the whole prompt; protected sections are kept.',
  'rule.remove.name': 'Remove sections',
  'rule.remove.hint': 'Drop the named sections from the assembled prompt.',
  'rule.substitute.name': 'Find and replace',
  'rule.substitute.hint': 'Rewrite matching text inside the sections that remain.',

  'rule.field.text': 'Text',
  'rule.field.textPlaceholder': 'Answer in at most three sentences.',
  'rule.field.interpolate': 'Resolve {{model}}, {{provider}}, and {{cwd}} in this text',
  'rule.field.sections': 'Sections',
  'rule.field.sectionsAll': 'All sections',
  'rule.field.sectionsPlaceholder': 'harness:identity, tool:bash',
  'rule.field.after': 'After this section',
  'rule.field.afterPlaceholder': 'harness:identity',
  'rule.field.pattern': 'Pattern',
  'rule.field.patternPlaceholder': 'bash',
  'rule.field.flags': 'Flags',
  'rule.field.replacement': 'Replace with',
  'rule.field.replacementPlaceholder': 'Use $1 and $2 for captured groups',
  'rule.enabled': 'On',
  'rule.moveUp': 'Move up',
  'rule.moveDown': 'Move down',
  'rule.delete': 'Remove rule',
  'rule.badge.disabled': 'Off',
  'rule.badge.invalid': 'Invalid',
  'rule.badge.shadowed': 'No effect',

  'rule.error.textRequired': 'Give this rule some text.',
  'rule.error.sectionsRequired': 'Name at least one section.',
  'rule.error.anchorRequired': 'Name the section this text goes after.',
  'rule.error.patternRequired': 'Give this rule a pattern.',
  'rule.error.flagsInvalid': 'Flags may only be g, i, m, s, u, each at most once.',
  'rule.error.patternSyntax': 'This pattern is not valid: {message}',
  'rule.error.replaceDuplicate': 'Only one “Replace everything” rule can be on at a time.',

  'preview.heading': 'Preview',
  'preview.sections': 'Sections',
  'preview.prompt': 'Prompt',
  'preview.loading': 'Building the preview…',
  'preview.error': 'The preview failed: {message}',
  'preview.empty': 'This preset leaves the task with no system prompt at all.',
  'preview.needsSession': 'Open a task to preview this preset against it.',
  'preview.refresh': 'Refresh',
  'preview.tag.added': 'Added',
  'preview.tag.removed': 'Removed',
  'preview.tag.changed': 'Changed',
  'preview.tag.protected': 'Protected',
  'preview.warn.invalidPattern': 'Rule {position} has an unusable pattern and was skipped: {detail}',
  'preview.warn.patternTooLong': 'Rule {position} has a pattern longer than this deployment allows.',
  'preview.warn.unknownSection': 'No section named “{section}” exists in this preview.',
  'preview.warn.noMatch': 'Rule {position} matched nothing in this preview.',
  'preview.warn.protectedKept': 'Section “{section}” states a rule the executor enforces, so it is kept.',
  'preview.warn.completeOverridden': 'This task’s agent preset set “{section}” as its whole prompt; these rules replace it.',
  'preview.warn.renderFailed': 'The result could not be rendered, so the preset would be skipped: {detail}',
  'preview.warn.unknownPreset': 'The selected preset is no longer stored.',
  'preview.warn.emptyPrompt': 'The task would receive no system prompt.',
  'preview.warn.unknown': '{detail}',

  'seat.label': 'Prompt',
  'seat.none': 'No preset',
  'seat.hint': 'Prompt preset applied to this task’s system prompt',
  'seat.appliesNextTurn': 'Applies from the next turn; messages already sent are unchanged.',
  'seat.switchFailed': 'Could not switch: {message}',
  'seat.manage': 'Manage presets…',
}

/** Chinese copy. */
export const zh: Record<PromptPresetKey, string> = {
  nav: '提示词预设',
  intro:
    '提示词预设是一组有序规则，作用于任务组装出的系统提示词：在其前后添加文本、整体替换、按名称移除小节，'
    + '以及对剩余内容做查找替换。可在任务界面随时选择。',
  error: '出错了：{message}',
  retry: '重试',
  unavailable: '本部署不存储提示词预设。',

  presetsHeading: '预设',
  newPreset: '新建预设',
  builtIn: '内置',
  defaultTag: '默认',
  setDefault: '设为默认',
  deletePreset: '删除',
  ruleCount: '{count} 条规则',
  rosterEmpty: '还没有预设。',
  noDescription: '没有描述',

  createTitle: '新建提示词预设',
  createIntro: 'id 将作为该预设的存储键，之后无法修改。',
  presetId: 'id',
  presetIdPlaceholder: 'terse',
  displayName: '名称',
  displayNamePlaceholder: '简洁',
  create: '创建',
  creating: '创建中…',
  cancel: '取消',
  idRequired: '请为预设填写 id。',
  idInvalid: '只能使用小写字母、数字与连字符，且以字母或数字开头。',
  idTaken: '该 id 已被占用。',

  presetName: '名称',
  presetNamePlaceholder: '简洁',
  presetDescription: '描述',
  presetDescriptionPlaceholder: '回答简短，不要铺垫。',
  rulesHeading: '规则',
  rulesEmpty: '还没有规则。添加一条，开始调整提示词。',
  addRule: '添加规则',
  save: '保存',
  saving: '保存中…',
  discard: '放弃修改',
  saveBlocked: '请先修正标红的规则再保存。',
  editorEmpty: '选择一个预设以进行编辑。',
  unsavedTitle: '放弃未保存的修改？',
  unsavedDescription: '该预设有从未保存的修改，离开将会丢失。',
  unsavedDiscard: '放弃',
  unsavedKeep: '继续编辑',
  deleteTitle: '删除该预设？',
  deleteDescription: '已经在其之下运行的任务会继续运行；其余不受影响。',
  deleteConfirm: '删除',
  deleting: '删除中…',

  'rule.prepend.name': '前置追加',
  'rule.prepend.hint': '在所有已有小节之前插入文本。',
  'rule.append.name': '后置追加',
  'rule.append.hint': '在所有已有小节之后插入文本。',
  'rule.insert.name': '指定小节后追加',
  'rule.insert.hint': '把文本插入到某个指定小节的正后面。',
  'rule.replace.name': '整体替换',
  'rule.replace.hint': '用这段文本作为整个提示词；受保护的小节会被保留。',
  'rule.remove.name': '移除小节',
  'rule.remove.hint': '从组装结果中删除指定名称的小节。',
  'rule.substitute.name': '查找替换',
  'rule.substitute.hint': '对剩余小节中匹配到的文本做改写。',

  'rule.field.text': '文本',
  'rule.field.textPlaceholder': '回答不超过三句话。',
  'rule.field.interpolate': '解析这段文本中的 {{model}}、{{provider}} 与 {{cwd}}',
  'rule.field.sections': '作用小节',
  'rule.field.after': '插入到该小节之后',
  'rule.field.afterPlaceholder': 'harness:identity',
  'rule.field.sectionsAll': '全部小节',
  'rule.field.sectionsPlaceholder': 'harness:identity, tool:bash',
  'rule.field.pattern': '匹配式',
  'rule.field.patternPlaceholder': 'bash',
  'rule.field.flags': '标志',
  'rule.field.replacement': '替换为',
  'rule.field.replacementPlaceholder': '可用 $1、$2 引用捕获组',
  'rule.enabled': '启用',
  'rule.moveUp': '上移',
  'rule.moveDown': '下移',
  'rule.delete': '删除规则',
  'rule.badge.disabled': '已关闭',
  'rule.badge.invalid': '无效',
  'rule.badge.shadowed': '不生效',

  'rule.error.textRequired': '请填写该规则的文本。',
  'rule.error.sectionsRequired': '至少指定一个小节名称。',
  'rule.error.anchorRequired': '请指定这段文本要跟在哪个小节后面。',
  'rule.error.patternRequired': '请填写匹配式。',
  'rule.error.flagsInvalid': '标志只能是 g、i、m、s、u，且不可重复。',
  'rule.error.patternSyntax': '该匹配式无效：{message}',
  'rule.error.replaceDuplicate': '同时只能启用一条「整体替换」规则。',

  'preview.heading': '预览',
  'preview.sections': '小节',
  'preview.prompt': '提示词',
  'preview.loading': '正在生成预览…',
  'preview.error': '预览失败：{message}',
  'preview.empty': '该预设会让任务完全没有系统提示词。',
  'preview.needsSession': '打开一个任务，以针对它预览该预设。',
  'preview.refresh': '刷新',
  'preview.tag.added': '新增',
  'preview.tag.removed': '移除',
  'preview.tag.changed': '改动',
  'preview.tag.protected': '受保护',
  'preview.warn.invalidPattern': '第 {position} 条规则的匹配式无法使用，已跳过：{detail}',
  'preview.warn.patternTooLong': '第 {position} 条规则的匹配式超出本部署允许的长度。',
  'preview.warn.unknownSection': '本次预览中不存在名为「{section}」的小节。',
  'preview.warn.noMatch': '第 {position} 条规则在本次预览中没有匹配到内容。',
  'preview.warn.protectedKept': '小节「{section}」陈述的是执行器强制执行的规则，因此予以保留。',
  'preview.warn.completeOverridden': '本任务的 Agent 预设把「{section}」设为了完整提示词；这些规则将其取代。',
  'preview.warn.renderFailed': '结果无法渲染，该预设会被跳过：{detail}',
  'preview.warn.unknownPreset': '所选预设已不再存储。',
  'preview.warn.emptyPrompt': '任务将收不到任何系统提示词。',
  'preview.warn.unknown': '{detail}',

  'seat.label': '提示词',
  'seat.none': '不使用预设',
  'seat.hint': '作用于本任务系统提示词的提示词预设',
  'seat.appliesNextTurn': '自下一轮起生效，已发送的消息不受影响。',
  'seat.switchFailed': '切换失败：{message}',
  'seat.manage': '管理预设…',
}
