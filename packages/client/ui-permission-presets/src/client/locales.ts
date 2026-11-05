/** `settings.permission` namespace dictionaries (the Permission row's copy). */

/** Locale namespace shared by both current-session permission pickers. */
export const PERMISSION_ACCESS_NS = 'permission.access'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'title': '权限',
  'description': '选择新会话的默认权限模式',
  'loading': '加载中',
  'unavailable': '不可用',
  'preset.readOnly': '仅可查看',
  'preset.workspaceWrite': '工作区内修改',
  'preset.fullAccess': '完全权限',
} satisfies Record<string, string>

/** The settings.permission namespace key union. */
export type PermissionSettingsKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'title': 'Permission',
  'description': 'Choose the default permission mode for new sessions',
  'loading': 'Loading',
  'unavailable': 'Unavailable',
  'preset.readOnly': 'Read Only',
  'preset.workspaceWrite': 'Workspace Write',
  'preset.fullAccess': 'Full access',
} satisfies Record<PermissionSettingsKey, string>

/** Simplified Chinese dictionary for the current-session popup gate. */
export const accessZh = {
  'mode': '访问模式，当前：{name}',
  'close': '关闭',
  'preset.readOnly': '仅可查看',
  'preset.workspaceWrite': '工作区内修改',
  'preset.fullAccess': '完全权限',
  'confirm.cancel': '取消',
  'auto.label': '自动审查',
  'auto.badge': 'EXP',
  'auto.description': '无沙箱运行；每次原生工具调用和 PTC 内层调用前由同一模型进行实验性审查。',
  'auto.confirm.title': '确认启用自动审查（实验）？',
  'auto.confirm.description': '自动审查不使用沙箱。每次原生工具调用和 PTC 内层调用前，都会由与当前 agent 相同的模型进行审查；审查拒绝的调用由你批准或拒绝。此功能仍属实验性，可能误放行或误拒绝，并会消耗额外 token。',
  'auto.confirm.acknowledge': '我已了解这些风险，并愿意继续',
  'auto.confirm.enable': '启用自动审查',
} satisfies Record<string, string>

/** Current-session popup-gate key union. */
export type PermissionAccessKey = keyof typeof accessZh

/** English dictionary for the current-session popup gate. */
export const accessEn = {
  'mode': 'Access mode, current: {name}',
  'close': 'Close',
  'preset.readOnly': 'Read Only',
  'preset.workspaceWrite': 'Workspace Write',
  'preset.fullAccess': 'Full access',
  'confirm.cancel': 'Cancel',
  'auto.label': 'Auto review',
  'auto.badge': 'EXP',
  'auto.description': 'Run without a sandbox after an experimental same-model review of every native tool call and PTC inner call.',
  'auto.confirm.title': 'Enable Auto review (experimental)?',
  'auto.confirm.description': 'Auto review runs without a sandbox. Before every native tool call and PTC inner call, the same model as the current agent reviews whether to allow it; you approve or reject each call it denies. This feature is experimental, can falsely allow or deny actions, and uses additional tokens.',
  'auto.confirm.acknowledge': 'I understand these risks and want to continue',
  'auto.confirm.enable': 'Enable Auto review',
} satisfies Record<PermissionAccessKey, string>

/** Japanese copy, checked against the English keys. */
export const ja = {
  'title': '権限',
  'description': '新しいセッションのデフォルトの権限モードを選択',
  'loading': '読み込み中',
  'unavailable': '利用不可',
  'preset.readOnly': '読み取り専用',
  'preset.workspaceWrite': 'ワークスペース書き込み',
  'preset.fullAccess': 'フルアクセス',
} satisfies Record<keyof typeof en, string>

/** Spanish dictionary, checked against the English keys. */
export const es = {
  'title': 'Permiso',
  'description': 'Elija el modo de permiso predeterminado para nuevas sesiones',
  'loading': 'Cargando',
  'unavailable': 'No disponible',
  'preset.readOnly': 'Sólo lectura',
  'preset.workspaceWrite': 'Escritura en el espacio de trabajo',
  'preset.fullAccess': 'Acceso completo',
} satisfies Record<keyof typeof en, string>

/** French dictionary, checked against the English keys. */
export const fr = {
  'title': 'Autorisation',
  'description': "Choisissez le mode d'autorisation par défaut pour les nouvelles sessions",
  'loading': 'Chargement',
  'unavailable': 'Indisponible',
  'preset.readOnly': 'Lecture seule',
  'preset.workspaceWrite': "Écriture dans l'espace de travail",
  'preset.fullAccess': 'Accès complet',
} satisfies Record<keyof typeof en, string>

/** German dictionary, checked against the English keys. */
export const de = {
  'title': 'Erlaubnis',
  'description': 'Wählen Sie den Standardberechtigungsmodus für neue Sitzungen',
  'loading': 'Laden',
  'unavailable': 'Nicht verfügbar',
  'preset.readOnly': 'Nur lesen',
  'preset.workspaceWrite': 'Arbeitsbereich schreiben',
  'preset.fullAccess': 'Voller Zugriff',
} satisfies Record<keyof typeof en, string>

/** Russian dictionary, checked against the English keys. */
export const ru = {
  'title': 'Разрешение',
  'description': 'Выберите режим разрешений по умолчанию для новых сеансов',
  'loading': 'Загрузка',
  'unavailable': 'Недоступно',
  'preset.readOnly': 'Только чтение',
  'preset.workspaceWrite': 'Запись в рабочей области',
  'preset.fullAccess': 'Полный доступ',
} satisfies Record<keyof typeof en, string>

/** Portuguese dictionary, checked against the English keys. */
export const pt = {
  'title': 'Permissão',
  'description': 'Escolha o modo de permissão padrão para novas sessões',
  'loading': 'Carregando',
  'unavailable': 'Indisponível',
  'preset.readOnly': 'Somente leitura',
  'preset.workspaceWrite': 'Gravação no espaço de trabalho',
  'preset.fullAccess': 'Acesso total',
} satisfies Record<keyof typeof en, string>

/** Japanese copy, checked against the English keys. */
export const accessJa = {
  'mode': 'アクセスモード、現在: {name}',
  'close': '閉じる',
  'preset.readOnly': '読み取り専用',
  'preset.workspaceWrite': 'ワークスペース書き込み',
  'preset.fullAccess': 'フルアクセス',
  'confirm.cancel': 'キャンセル',
  'auto.label': '自動認可レビュー',
  'auto.badge': 'EXP',
  'auto.description': 'すべてのネイティブツール呼び出しと PTC 内部呼び出しを実験的な同一モデルでレビューしたうえで、サンドボックスなしで実行します。',
  'auto.confirm.title': '自動認可レビュー（実験的）を有効にしますか？',
  'auto.confirm.description': '自動認可レビューはサンドボックスなしで実行されます。ネイティブツール呼び出しと PTC 内部呼び出しのたびに、現在のエージェントと同じモデルが許可可否をレビューし、拒否された呼び出しはあなたが承認または却下します。この機能は実験的であり、操作を誤って許可・拒否する可能性があり、追加のトークンを消費します。',
  'auto.confirm.acknowledge': 'これらのリスクを理解し、続行します',
  'auto.confirm.enable': '自動認可レビューを有効にする',
} satisfies Record<keyof typeof accessEn, string>

/** Spanish dictionary, checked against the English keys. */
export const accessEs = {
  'mode': 'Modo de acceso, actual: {name}',
  'close': 'Cerrar',
  'preset.readOnly': 'Sólo lectura',
  'preset.workspaceWrite': 'Escritura en el espacio de trabajo',
  'preset.fullAccess': 'Acceso completo',
  'confirm.cancel': 'Cancelar',
  'auto.label': 'Auto review',
  'auto.badge': 'EXP',
  'auto.description': 'Ejecute sin una zona de pruebas después de una revisión experimental del mismo modelo de cada llamada de herramienta nativa y llamada interna PTC.',
  'auto.confirm.title': '¿Habilitar Auto review (experimental)?',
  'auto.confirm.description': 'Auto review se ejecuta sin zona de pruebas. Antes de cada llamada a la herramienta nativa y llamada interna PTC, el mismo modelo que el agente actual revisa si se permite; usted aprueba o rechaza cada llamada que rechaza. Esta característica es experimental, puede permitir o denegar acciones falsamente y utiliza tokens adicionales.',
  'auto.confirm.acknowledge': 'Entiendo estos riesgos y quiero continuar',
  'auto.confirm.enable': 'Habilitar Auto review',
} satisfies typeof accessEn

/** French dictionary, checked against the English keys. */
export const accessFr = {
  'mode': "Mode d'accès, actuel : {name}",
  'close': 'Fermer',
  'preset.readOnly': 'Lecture seule',
  'preset.workspaceWrite': "Écriture dans l'espace de travail",
  'preset.fullAccess': 'Accès complet',
  'confirm.cancel': 'Annuler',
  'auto.label': 'Auto review',
  'auto.badge': 'EXP',
  'auto.description': "Exécutez sans bac à sable après un examen expérimental sur le même modèle de chaque appel d'outil natif et appel interne PTC.",
  'auto.confirm.title': 'Activer Auto review (expérimental) ?',
  'auto.confirm.description': "Auto review fonctionne sans bac à sable. Avant chaque appel d'outil natif et appel interne PTC, le même modèle que l'agent actuel vérifie s'il doit l'autoriser ; vous approuvez ou rejetez chaque appel qu'il refuse. Cette fonctionnalité est expérimentale, peut autoriser ou refuser à tort des actions et utilise des jetons supplémentaires.",
  'auto.confirm.acknowledge': 'Je comprends ces risques et je veux continuer',
  'auto.confirm.enable': 'Activer Auto review',
} satisfies typeof accessEn

/** German dictionary, checked against the English keys. */
export const accessDe = {
  'mode': 'Zugriffsmodus, aktuell: {name}',
  'close': 'Schließen',
  'preset.readOnly': 'Nur lesen',
  'preset.workspaceWrite': 'Arbeitsbereich schreiben',
  'preset.fullAccess': 'Voller Zugriff',
  'confirm.cancel': 'Abbrechen',
  'auto.label': 'Auto review',
  'auto.badge': 'EXP',
  'auto.description': 'Ausführung ohne Sandbox nach einer experimentellen, modellgleichen Überprüfung jedes nativen Toolaufrufs und PTC-Innenaufrufs.',
  'auto.confirm.title': 'Auto review aktivieren (experimentell)?',
  'auto.confirm.description': 'Auto review läuft ohne Sandbox. Vor jedem nativen Tool-Aufruf und PTC-Innenaufruf überprüft dasselbe Modell wie der aktuelle Agent, ob dies zulässig ist. Sie genehmigen oder lehnen jeden abgelehnten Aufruf ab. Diese Funktion ist experimentell, kann Aktionen fälschlicherweise zulassen oder verweigern und verwendet zusätzliche Token.',
  'auto.confirm.acknowledge': 'Ich verstehe diese Risiken und möchte weitermachen',
  'auto.confirm.enable': 'Aktivieren Sie Auto review',
} satisfies typeof accessEn

/** Russian dictionary, checked against the English keys. */
export const accessRu = {
  'mode': 'Режим доступа, текущий: {name}',
  'close': 'Закрыть',
  'preset.readOnly': 'Только чтение',
  'preset.workspaceWrite': 'Запись в рабочей области',
  'preset.fullAccess': 'Полный доступ',
  'confirm.cancel': 'Отмена',
  'auto.label': 'Auto review',
  'auto.badge': 'EXP',
  'auto.description': 'Запуск без песочницы после экспериментальной проверки одной и той же модели каждого вызова встроенного инструмента и внутреннего вызова PTC.',
  'auto.confirm.title': 'Включить Auto review (экспериментально)?',
  'auto.confirm.description': 'Auto review работает без песочницы. Перед каждым вызовом собственного инструмента и внутренним вызовом PTC та же модель, что и текущий агент, проверяет, разрешить ли это; вы одобряете или отклоняете каждый вызов, который он отклоняет. Эта функция является экспериментальной, может ошибочно разрешать или запрещать действия и использует дополнительные токены.',
  'auto.confirm.acknowledge': 'Я понимаю эти риски и хочу продолжить',
  'auto.confirm.enable': 'Включить Auto review',
} satisfies typeof accessEn

/** Portuguese dictionary, checked against the English keys. */
export const accessPt = {
  'mode': 'Modo de acesso, atual: {name}',
  'close': 'Fechar',
  'preset.readOnly': 'Somente leitura',
  'preset.workspaceWrite': 'Gravação no espaço de trabalho',
  'preset.fullAccess': 'Acesso total',
  'confirm.cancel': 'Cancelar',
  'auto.label': 'Auto review',
  'auto.badge': 'EXP',
  'auto.description': 'Execute sem um sandbox após uma revisão experimental do mesmo modelo de cada chamada de ferramenta nativa e PTC chamada interna.',
  'auto.confirm.title': 'Ativar Auto review (experimental)?',
  'auto.confirm.description': 'Auto review é executado sem sandbox. Antes de cada chamada de ferramenta nativa e chamada interna PTC, o mesmo modelo do agente atual analisa se deve permitir isso; você aprova ou rejeita cada chamada negada. Este recurso é experimental, pode permitir ou negar ações falsamente e usa tokens adicionais.',
  'auto.confirm.acknowledge': 'Entendo esses riscos e quero continuar',
  'auto.confirm.enable': 'Ativar Auto review',
} satisfies typeof accessEn
