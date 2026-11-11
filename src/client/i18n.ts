/**
 * Dictionaries for the two overview tabs (zh default, en). Registered under
 * the `toolscontrol` locale namespace and read through the host locale
 * binding, so labels follow the host language; MCP/Skills entry names are
 * never translated.
 *
 * Warning text is localized from structured `warningItems` first and falls
 * back to the raw `warnings` string for missing/mismatched/unknown codes.
 * This module also owns the small pure helpers shared by the views and the
 * tests (`sourceLabel`, `warningTexts`), so localization rules stay testable
 * without React.
 *
 * @module @hanxu131/toolscontrol-dsh/client/i18n
 */

/** Locale namespace owned by the client half. */
export const NS = 'toolscontrol'

/** Interpolation parameters accepted by the locale translator. */
export type TranslateParams = Record<string, string | number>

/** Minimal translate signature shared by the locale service and tests. */
export type MessageTranslate = (key: string, params?: TranslateParams) => string

/** zh dictionary (the default). */
export const zh = {
  'tab.mcp': 'MCP',
  'tab.skills': '技能',
  // common
  'common.refresh': '刷新',
  'common.retry': '重试',
  'common.loading': '加载中…',
  'common.details': '详情',
  'common.all': '全部',
  'common.yes': '是',
  'common.no': '否',
  // search
  'search.mcpPlaceholder': '搜索 MCP 名称',
  'search.skillsPlaceholder': '搜索技能名称、描述或适用场景',
  'search.aria.mcp': '搜索 MCP',
  'search.aria.skills': '搜索技能',
  // filters
  'filter.enabled': '启用状态',
  'filter.enabled.on': '已启用',
  'filter.enabled.off': '已禁用',
  'filter.status': '连接状态',
  'filter.source': '来源',
  'filter.invocation': '调用方式',
  'filter.invocation.user': '用户可调用',
  'filter.invocation.model': '模型可调用',
  'filter.invocation.none': '不可调用',
  // Skills-only filter group leads
  'skills.filter.allSources': '全部来源',
  'skills.filter.allInvocations': '全部调用方式',
  // workspace line
  'workspace.title': '当前工作区：{title}',
  'workspace.none': '未选中工作区 — 以下为全局技能，项目级目录未知',
  'workspace.sessionNoCwd': '当前会话：{sessionId} — 已按该会话的 preset 范围读取技能；项目目录未知',
  // status line / states
  'status.lastRefreshed': '上次刷新：{time}',
  'state.emptyAll': '当前范围内没有条目',
  'state.emptyFiltered': '没有找到符合条件的条目',
  'state.errorTitle': '无法获取数据',
  'state.staleNotice': '刷新失败，仍在显示上一次快照：{message}',
  'warnings.title': '注意事项',
  // MCP capability degradation (real status/tool count unobservable; probing is separate)
  'mcp.capabilityNote':
    '当前 Desktop 版本无法观测 MCP 的实时连接状态与工具数量：连接状态一律显示为「未知」，工具数量不随连接状态更新。可在条目详情中手动执行独立探测读取工具列表（不改变当前连接）。',
  'mcp.probeUnavailableNote': '当前 Host 无法读取 MCP 探测配置，手动工具探测不可用（{reason}）。',
  'mcp.probeMissingNote': '当前 Host 版本未提供独立探测能力（旧版 Host），仅展示配置与状态信息。',
  'mcp.probeAvailability.config_source_unavailable': '探测配置来源不可读',
  'mcp.probeAvailability.runtime_unavailable': '当前运行时不支持探测',
  'mcp.probeAvailability.unknown': '原因未知',
  // MCP statuses (open set: unknown labels fall back to the raw value)
  'mcp.status.unknown': '未知',
  'mcp.status.connected': '已连接',
  'mcp.status.connecting': '连接中',
  'mcp.status.reconnecting': '重新连接',
  'mcp.status.failed': '失败',
  'mcp.status.disabled': '已禁用',
  'mcp.status.waiting-credentials': '等待凭据',
  'mcp.status.closed': '已关闭',
  // MCP rows/detail
  'mcp.entryEnabled': '已启用',
  'mcp.entryDisabled': '已禁用',
  'mcp.configured': '已配置',
  'mcp.tools': '工具数量：{n}',
  'mcp.detailFor': '{name} 的详情',
  // MCP explicit probe (independent observation, keyed by probeKey)
  'mcp.probe.title': '最近探测',
  'mcp.probe.run': '探测工具',
  'mcp.probe.probing': '探测中…',
  'mcp.probe.notProbeable': '不可探测',
  'mcp.probeAll': '全部探测（{n}）',
  'mcp.probeAllTitle': '探测当前筛选结果中所有可探测条目',
  'mcp.probe.success': '探测成功：{n} 个工具',
  'mcp.probe.probedAt': '观测时间：{time}',
  'mcp.probe.duration': '耗时：{ms} ms',
  'mcp.probe.durationLabel': '耗时',
  'mcp.probe.emptySuccess': '探测成功，服务端未返回任何工具（0 个工具）',
  'mcp.probe.failed': '探测失败：{reason}',
  'mcp.probe.failedTransport': '探测请求未完成（网络错误或 Host 响应异常；原始错误已隐藏）',
  'mcp.probe.details': '安全详情',
  'mcp.probe.toolsToggle': '查看工具名（{n}）',
  'mcp.probe.stage': '阶段',
  'mcp.probe.code': '代码',
  'mcp.probeReason.disabled': '条目未启用',
  'mcp.probeReason.conditional': '条件启用（依赖无法静态求值）',
  'mcp.probeReason.config_missing': '缺少可读取的传输配置',
  'mcp.probeReason.config_unresolved': '配置表达式无法可靠求值',
  'mcp.probeReason.unsupported_transport': '传输方式不受支持',
  'mcp.probeReason.probe_unavailable': '当前 Host 无法探测该条目',
  'mcp.probeStage.connect': '连接阶段失败',
  'mcp.probeStage.tools_list': '读取工具列表失败',
  'mcp.probeStage.timeout': '探测超时',
  'mcp.probeStage.cancelled': '探测已取消',
  'mcp.probeStage.unavailable': '探测不可用',
  'mcp.probeStage.disabled': '条目未启用',
  'mcp.probeStage.transport': '请求未完成',
  'mcp.probeStage.unknown': '未知阶段',
  // MCP entry scope (profile root vs preset composition) + honest empty state
  'mcp.scope.profile': 'DSH profile 根级',
  'mcp.scope.preset': 'Preset：{name}',
  'mcp.scope.unknown': '作用域未知',
  'mcp.scopeLabel': '作用域',
  'mcp.entryConditional': '条件启用',
  'mcp.emptyAll': '当前 DSH profile / presets 未配置 MCP server（仅统计 DSH 内部数据源，未读取外部 CLI 配置）',
  // Skills
  'skills.shadowedTitle': '同名但被覆盖的版本（{n}）',
  'skills.shadowedBy': '被「{source}」覆盖',
  'skills.detailFor': '{name} 的详情',
  // fields
  'field.whenToUse': '适用场景',
  'field.path': '路径',
  'field.description': '描述',
  'field.source': '来源',
  'field.status': '连接状态',
  'field.invocation': '调用方式',
  'field.sourceUnknown': '未知',
  'field.tools': '工具数量',
  // sources (unknown/empty falls back to field.sourceUnknown; future labels to raw ids)
  'source.bundled': 'DSH 内置',
  'source.runtime': '插件提供',
  'source.custom': '自定义目录',
  'source.user-dsh': '用户 .dsh 目录',
  'source.user-agents': '用户 .agents 目录',
  'source.project-dsh': '项目 .dsh 目录',
  'source.project-agents': '项目 .agents 目录',
  'source.global': '全局',
  'source.unknown': '未知',
  // structured warnings (raw `warnings` remains the fallback)
  'warning.skills.unavailable': '技能服务不可用：无法列出实际生效的技能。',
  'warning.skills.registryFailed': '读取技能注册表失败：{message}',
  'warning.skills.agentsUnavailable': 'Agent 服务不可用：无法确认会话 {sessionId} 的 preset 范围，仅展示全局注册表。',
  'warning.skills.sessionNoAgent': '会话 {sessionId} 没有运行中的 Agent：无法读取该会话 preset 范围内的技能，仅展示全局注册表。',
  'warning.skills.sessionAgentFailed': '查询会话 {sessionId} 的 Agent 失败：{message}；仅展示全局注册表。',
  'warning.skills.presetFailed': '解析 preset 专属技能服务失败：{message}',
  'warning.skills.presetFailedFallback': '解析 preset 专属技能服务失败：{message}；已改用宿主技能注册表（仍带会话 scope）。',
  'warning.skills.shadowedIncomplete': '同名技能可能来自运行时、预设或自定义目录；被覆盖的版本不一定会全部列出。',
  'warning.skills.priorityUnconfirmed': '无法确认文件来源「{name}」（{source}）与生效版本（{winnerSource}）的优先级关系，因此未判定为被覆盖。',
  'warning.skills.fileReadFailed': '读取技能文件 {path} 失败：{message}',
  'warning.skills.fileIgnored': '技能文件 {path} 已被忽略：{reason}',
  'warning.skills.rootReadFailed': '读取技能根目录 {path} 失败：{message}',
  'warning.skills.aggregateFailed': '技能聚合失败：{message}',
  'warning.mcp.inventoryUnavailable': 'pluginInventory 服务不可用：无法读取 MCP 配置条目。',
  'warning.mcp.inventoryReadFailed': '读取 pluginInventory 失败：{message}',
  'warning.mcp.inventoryUnparsable': 'pluginInventory 返回了无法解析的清单结果。',
  'warning.mcp.entriesUnparsable': 'pluginInventory 未返回可解析的 entries 列表，已跳过 profile 根级条目。',
  'warning.mcp.presetsUnparsable': 'pluginInventory 的 agentPresets 无法解析，已仅统计 profile 根级 MCP 条目。',
  'warning.mcp.invalidEnabledRows': 'pluginInventory 返回了 {n} 条启用状态无法解析的 MCP 条目，已跳过。',
  'warning.mcp.invalidRows': 'pluginInventory 返回了 {n} 条无法解析的插件条目，已跳过。',
  'warning.mcp.duplicates': '已忽略 {n} 条重复的 MCP 条目（同一 profile/preset 作用域内同名条目只保留首条；不同作用域的同名条目不算重复）。',
  'warning.mcp.managerReadFailed': '读取 mcpManager 失败：{message}',
  'warning.mcp.statusUnparsable': 'MCP 条目 {name} 返回了无法解析的状态，已按未知处理。',
  'warning.mcp.presetInvalid': 'pluginInventory 返回了无法解析的 preset 条目（第 {index} 项），已跳过。',
  'warning.mcp.presetNoId': 'pluginInventory 返回了缺少 id 的 preset 条目（第 {index} 项），已跳过。',
  'warning.mcp.presetBroken': 'preset「{label}」组合加载失败，其中条目可能不完整：{reason}',
  'warning.mcp.presetBrokenNoReason': 'preset「{label}」组合加载失败，其中条目可能不完整。',
  'warning.mcp.presetRowsUnparsable': 'preset「{label}」的条目列表无法解析，已跳过该 preset 的组合行。',
  'warning.mcp.aggregateFailed': 'MCP 聚合失败：{message}',
} as const

/** en dictionary. */
export const en: Record<keyof typeof zh, string> = {
  'tab.mcp': 'MCP',
  'tab.skills': 'Skills',
  'common.refresh': 'Refresh',
  'common.retry': 'Retry',
  'common.loading': 'Loading…',
  'common.details': 'Details',
  'common.all': 'All',
  'common.yes': 'Yes',
  'common.no': 'No',
  'search.mcpPlaceholder': 'Search MCP by name',
  'search.skillsPlaceholder': 'Search skill name, description, or when to use',
  'search.aria.mcp': 'Search MCP',
  'search.aria.skills': 'Search skills',
  'filter.enabled': 'Enabled state',
  'filter.enabled.on': 'Enabled',
  'filter.enabled.off': 'Disabled',
  'filter.status': 'Connection status',
  'filter.source': 'Source',
  'filter.invocation': 'Invocation mode',
  'filter.invocation.user': 'User-invocable',
  'filter.invocation.model': 'Model-invocable',
  'filter.invocation.none': 'Not invocable',
  'skills.filter.allSources': 'All sources',
  'skills.filter.allInvocations': 'All invocation modes',
  'workspace.title': 'Current workspace: {title}',
  'workspace.none': 'No workspace selected — showing global skills; the project directory is unknown',
  'workspace.sessionNoCwd':
    'Session: {sessionId} — showing skills from the session preset scope; the project directory is unknown',
  'status.lastRefreshed': 'Last refreshed: {time}',
  'state.emptyAll': 'No entries in this scope',
  'state.emptyFiltered': 'No entries match these filters',
  'state.errorTitle': 'Unable to load data',
  'state.staleNotice': 'Refresh failed; showing the previous snapshot: {message}',
  'warnings.title': 'Notes',
  'mcp.capabilityNote':
    'This Desktop build cannot observe live MCP connection status or tool counts: status always shows as Unknown, and tool counts are not updated from the connection. Run an explicit independent probe from an entry’s details to read its tool list (the live connection is not affected).',
  'mcp.probeUnavailableNote': 'This Host cannot read the MCP probe configuration, so manual tool probing is unavailable ({reason}).',
  'mcp.probeMissingNote':
    'This Host version does not provide the independent probe capability (older Host); only configuration and status are shown.',
  'mcp.probeAvailability.config_source_unavailable': 'the probe configuration source is unreadable',
  'mcp.probeAvailability.runtime_unavailable': 'this runtime does not support probing',
  'mcp.probeAvailability.unknown': 'unknown reason',
  'mcp.status.unknown': 'Unknown',
  'mcp.status.connected': 'Connected',
  'mcp.status.connecting': 'Connecting',
  'mcp.status.reconnecting': 'Reconnecting',
  'mcp.status.failed': 'Failed',
  'mcp.status.disabled': 'Disabled',
  'mcp.status.waiting-credentials': 'Waiting for credentials',
  'mcp.status.closed': 'Closed',
  'mcp.entryEnabled': 'Enabled',
  'mcp.entryDisabled': 'Disabled',
  'mcp.configured': 'Configured',
  'mcp.tools': 'Tools: {n}',
  'mcp.detailFor': 'Details for {name}',
  'mcp.probe.title': 'Last probe',
  'mcp.probe.run': 'Probe tools',
  'mcp.probe.probing': 'Probing…',
  'mcp.probe.notProbeable': 'Not probeable',
  'mcp.probeAll': 'Probe all ({n})',
  'mcp.probeAllTitle': 'Probe every probeable entry in the current filtered results',
  'mcp.probe.success': 'Probe succeeded: {n} tool(s)',
  'mcp.probe.probedAt': 'Observed at: {time}',
  'mcp.probe.duration': 'Duration: {ms} ms',
  'mcp.probe.durationLabel': 'Duration',
  'mcp.probe.emptySuccess': 'Probe succeeded; the server returned no tools (0 tools)',
  'mcp.probe.failed': 'Probe failed: {reason}',
  'mcp.probe.failedTransport': 'The probe request did not complete (network error or unexpected Host response; the raw error is hidden)',
  'mcp.probe.details': 'Safe details',
  'mcp.probe.toolsToggle': 'Tool names ({n})',
  'mcp.probe.stage': 'Stage',
  'mcp.probe.code': 'Code',
  'mcp.probeReason.disabled': 'The entry is not enabled',
  'mcp.probeReason.conditional': 'Conditionally enabled (its condition cannot be evaluated statically)',
  'mcp.probeReason.config_missing': 'No readable transport configuration',
  'mcp.probeReason.config_unresolved': 'The configuration expression cannot be evaluated reliably',
  'mcp.probeReason.unsupported_transport': 'The transport type is not supported',
  'mcp.probeReason.probe_unavailable': 'This Host cannot probe the entry',
  'mcp.probeStage.connect': 'Failed while connecting',
  'mcp.probeStage.tools_list': 'Failed to read the tool list',
  'mcp.probeStage.timeout': 'Probe timed out',
  'mcp.probeStage.cancelled': 'Probe cancelled',
  'mcp.probeStage.unavailable': 'Probing unavailable',
  'mcp.probeStage.disabled': 'Entry not enabled',
  'mcp.probeStage.transport': 'Request did not complete',
  'mcp.probeStage.unknown': 'Unknown stage',
  'mcp.scope.profile': 'DSH profile root',
  'mcp.scope.preset': 'Preset: {name}',
  'mcp.scope.unknown': 'Unknown scope',
  'mcp.scopeLabel': 'Scope',
  'mcp.entryConditional': 'Conditionally enabled',
  'mcp.emptyAll':
    'No MCP server is configured in the current DSH profile or its presets (DSH-internal sources only; external CLI configs are not read)',
  'skills.shadowedTitle': 'Same-name overridden versions ({n})',
  'skills.shadowedBy': 'Overridden by {source}',
  'skills.detailFor': 'Details for {name}',
  'field.whenToUse': 'When to use',
  'field.path': 'Path',
  'field.description': 'Description',
  'field.source': 'Source',
  'field.status': 'Connection status',
  'field.invocation': 'Invocation mode',
  'field.sourceUnknown': 'Unknown',
  'field.tools': 'Tools',
  'source.bundled': 'DSH built-in',
  'source.runtime': 'Plugin runtime',
  'source.custom': 'Custom directory',
  'source.user-dsh': 'User .dsh directory',
  'source.user-agents': 'User .agents directory',
  'source.project-dsh': 'Project .dsh directory',
  'source.project-agents': 'Project .agents directory',
  'source.global': 'Global',
  'source.unknown': 'Unknown',
  'warning.skills.unavailable': 'The skills service is unavailable, so effective skills cannot be listed.',
  'warning.skills.registryFailed': 'Failed to read the skills registry: {message}',
  'warning.skills.agentsUnavailable':
    'The agents service is unavailable, so the preset scope of session {sessionId} cannot be determined; showing the global registry only.',
  'warning.skills.sessionNoAgent':
    "Session {sessionId} has no running Agent, so skills in that session's preset scope cannot be read; showing the global registry only.",
  'warning.skills.sessionAgentFailed':
    'Failed to look up the Agent for session {sessionId}: {message}; showing the global registry only.',
  'warning.skills.presetFailed': 'Failed to resolve the preset-specific skills service: {message}',
  'warning.skills.presetFailedFallback':
    'Failed to resolve the preset-specific skills service: {message}; falling back to the host skills registry (still scoped to the session).',
  'warning.skills.shadowedIncomplete':
    'Skills with the same name can come from the runtime, presets, or custom directories. Some overridden versions may not be shown.',
  'warning.skills.priorityUnconfirmed':
    'Cannot determine the priority between file source "{name}" ({source}) and the effective version ({winnerSource}); it was not marked as overridden.',
  'warning.skills.fileReadFailed': 'Failed to read skill file {path}: {message}',
  'warning.skills.fileIgnored': 'Skill file {path} was ignored: {reason}',
  'warning.skills.rootReadFailed': 'Failed to read skill root {path}: {message}',
  'warning.skills.aggregateFailed': 'Skills aggregation failed: {message}',
  'warning.mcp.inventoryUnavailable': 'The pluginInventory service is unavailable, so MCP configuration entries cannot be read.',
  'warning.mcp.inventoryReadFailed': 'Failed to read pluginInventory: {message}',
  'warning.mcp.inventoryUnparsable': 'pluginInventory returned an unparsable inventory result.',
  'warning.mcp.entriesUnparsable': 'pluginInventory returned no parsable entries list; profile-root entries were skipped.',
  'warning.mcp.presetsUnparsable':
    "pluginInventory's agentPresets could not be parsed; only profile-root MCP entries were counted.",
  'warning.mcp.invalidEnabledRows': 'pluginInventory returned {n} MCP entries with an unparsable enabled state; they were skipped.',
  'warning.mcp.invalidRows': 'pluginInventory returned {n} unparsable plugin entries; they were skipped.',
  'warning.mcp.duplicates':
    'Ignored {n} duplicate MCP entries (within one profile/preset scope only the first same-name entry is kept; same-name entries in different scopes are not duplicates).',
  'warning.mcp.managerReadFailed': 'Failed to read mcpManager: {message}',
  'warning.mcp.statusUnparsable': 'MCP entry {name} returned an unparsable status; it was treated as unknown.',
  'warning.mcp.presetInvalid': 'pluginInventory returned an unparsable preset entry (item {index}); it was skipped.',
  'warning.mcp.presetNoId': 'pluginInventory returned a preset entry without an id (item {index}); it was skipped.',
  'warning.mcp.presetBroken': 'Preset "{label}" failed to load its composition; some entries may be missing: {reason}',
  'warning.mcp.presetBrokenNoReason': 'Preset "{label}" failed to load its composition; some entries may be missing.',
  'warning.mcp.presetRowsUnparsable': 'Preset "{label}" has an unparsable entry list; its composition rows were skipped.',
  'warning.mcp.aggregateFailed': 'MCP aggregation failed: {message}',
}

/**
 * Localized label of a source id. Known ids use `source.<id>`; `unknown` and
 * the empty string use the generic "Unknown" label; every other (future)
 * source falls back to the raw id, which is also what the filter preserves.
 */
export function sourceLabel(source: string, t: MessageTranslate): string {
  if (source === '' || source === 'unknown') return t('field.sourceUnknown')
  const key = `source.${source}`
  const label = t(key)
  return label === key || label === '' ? source : label
}

/**
 * Localized warning lines in the same order as the raw `warnings`.
 *
 * Backward compatibility: a missing `warningItems` entry, a length mismatch,
 * an unknown code, or an empty translation all fall back to that position's
 * raw string. Extra items beyond `warnings` are ignored.
 */
export function warningTexts(
  warnings: readonly string[],
  items: readonly { code: string; params?: TranslateParams }[] | undefined,
  t: MessageTranslate,
): string[] {
  return warnings.map((raw, index) => {
    const item = items?.[index]
    if (item === undefined || typeof item.code !== 'string' || item.code === '') return raw
    const key = `warning.${item.code}`
    const text = t(key, item.params)
    return text === key || text === '' ? raw : text
  })
}

/** Localized, stable reason of a NOT-probeable entry (unknown codes fall back). */
export function probeReasonText(reason: string | undefined, t: MessageTranslate): string {
  const code = typeof reason === 'string' && reason !== '' ? reason : 'probe_unavailable'
  const key = `mcp.probeReason.${code}`
  const text = t(key)
  if (text !== key && text !== '') return text
  return t('mcp.probeReason.probe_unavailable')
}

/** Localized probe availability degradation reason (missing `probe` ⇒ legacy note, not this). */
export function probeAvailabilityText(reason: string | undefined, t: MessageTranslate): string {
  const code = typeof reason === 'string' && reason !== '' ? reason : 'unknown'
  const key = `mcp.probeAvailability.${code}`
  const text = t(key)
  if (text !== key && text !== '') return text
  return t('mcp.probeAvailability.unknown')
}

/**
 * Localized failure stage/code. Only the Host's fixed stage enum is ever
 * rendered — never the sanitized-but-raw `message` or a client error string.
 */
export function probeStageText(stage: string | undefined, t: MessageTranslate): string {
  const code = typeof stage === 'string' && stage !== '' ? stage : 'unknown'
  const key = `mcp.probeStage.${code}`
  const text = t(key)
  if (text !== key && text !== '') return text
  return t('mcp.probeStage.unknown')
}
