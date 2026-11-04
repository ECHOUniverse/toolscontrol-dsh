/**
 * Dictionaries for the two overview tabs (zh default, en). Registered under
 * the `toolscontrol` locale namespace and read through the host locale
 * binding, so labels follow the host language; MCP/Skills entry names are
 * never translated.
 *
 * @module @hanxu131/toolscontrol-dsh/client/i18n
 */

/** Locale namespace owned by the client half. */
export const NS = 'toolscontrol'

/** zh dictionary (the default). */
export const zh = {
  'tab.mcp': 'MCP',
  'tab.skills': 'Skills',
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
  'search.skillsPlaceholder': '搜索名称/描述/使用时机',
  'search.aria.mcp': '搜索 MCP',
  'search.aria.skills': '搜索 Skills',
  // filters
  'filter.enabled': '启用状态',
  'filter.enabled.on': '已启用',
  'filter.enabled.off': '已禁用',
  'filter.status': '连接状态',
  'filter.source': '来源',
  'filter.invocation': '调用方式',
  'filter.invocation.user': '人工可调用',
  'filter.invocation.model': '模型可调用',
  'filter.invocation.none': '均不可调用',
  // workspace line
  'workspace.title': '工作区：{title}',
  'workspace.none': '未选中工作区 — 以下为全局 Skills，项目级目录未知',
  // status line / states
  'status.lastRefreshed': '最近刷新：{time}',
  'state.emptyAll': '当前范围内没有条目',
  'state.emptyFiltered': '没有匹配的条目',
  'state.errorTitle': '快照获取失败',
  'state.staleNotice': '刷新失败，仍在显示上一次快照：{message}',
  'warnings.title': '限制与警告',
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
  // Skills
  'skills.shadowedTitle': '被遮蔽版本（{n}）',
  'skills.shadowedBy': '被 {source} 遮蔽',
  'skills.detailFor': '{name} 的详情',
  // fields
  'field.whenToUse': '使用时机',
  'field.path': '路径',
  'field.description': '描述',
  'field.source': '来源',
  'field.status': '连接状态',
  'field.invocation': '调用方式',
  'field.sourceUnknown': '未知',
  'field.tools': '工具数量',
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
  'search.skillsPlaceholder': 'Search name/description/when to use',
  'search.aria.mcp': 'Search MCP',
  'search.aria.skills': 'Search skills',
  'filter.enabled': 'Enabled state',
  'filter.enabled.on': 'Enabled',
  'filter.enabled.off': 'Disabled',
  'filter.status': 'Connection status',
  'filter.source': 'Source',
  'filter.invocation': 'Invocation',
  'filter.invocation.user': 'User-invocable',
  'filter.invocation.model': 'Model-invocable',
  'filter.invocation.none': 'Not invocable',
  'workspace.title': 'Workspace: {title}',
  'workspace.none': 'No workspace selected — showing global skills; the project directory is unknown',
  'status.lastRefreshed': 'Last refreshed: {time}',
  'state.emptyAll': 'No entries in this scope',
  'state.emptyFiltered': 'No matching entries',
  'state.errorTitle': 'Failed to load the snapshot',
  'state.staleNotice': 'Refresh failed; showing the previous snapshot: {message}',
  'warnings.title': 'Limits and warnings',
  'mcp.capabilityNote': 'This Desktop build cannot observe MCP connection status or tool counts; every status shows as Unknown and tool probing is unavailable.',
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
  'skills.shadowedTitle': 'Shadowed versions ({n})',
  'skills.shadowedBy': 'Shadowed by {source}',
  'skills.detailFor': 'Details for {name}',
  'field.whenToUse': 'When to use',
  'field.path': 'Path',
  'field.description': 'Description',
  'field.source': 'Source',
  'field.status': 'Connection status',
  'field.invocation': 'Invocation',
  'field.sourceUnknown': 'Unknown',
  'field.tools': 'Tools',
}
