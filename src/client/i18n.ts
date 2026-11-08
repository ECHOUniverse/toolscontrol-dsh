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
  // MCP capability degradation
  'mcp.capabilityNote': '当前 Desktop 版本无法观测 MCP 连接状态与工具数量；状态一律显示为「未知」，工具探测不可用。',
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
  'mcp.loadTools': '加载工具列表',
  'mcp.probing': '探测中…',
  'mcp.probeFailed': '探测失败：{message}',
  'mcp.probeEmpty': '未返回任何工具',
  'mcp.detailFor': '{name} 的详情',
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
    'This Desktop build cannot observe MCP connection status or tool counts; every status shows as Unknown and tool probing is unavailable.',
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
  'mcp.loadTools': 'Load tool list',
  'mcp.probing': 'Probing…',
  'mcp.probeFailed': 'Probe failed: {message}',
  'mcp.probeEmpty': 'No tools returned',
  'mcp.detailFor': 'Details for {name}',
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
