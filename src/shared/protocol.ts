/**
 * Wire contract shared by the host half and the (future) client half of
 * `@hanxu131/toolscontrol-dsh`.
 *
 * This module is the single source for the plugin identity, the `webServer`
 * route table the host half registers, and the JSON payloads both halves
 * exchange. It is pure data: no Node or browser imports.
 *
 * Security posture (task red lines):
 * - No wire type may carry MCP env/headers/credentials/command/URL material.
 *   The rc.5 aggregation reads the plugin inventory only for
 *   `{entryId, moduleName, enabled}` and never echoes anything else.
 * - MCP connection status is `unknown` unless the official mcpManager service
 *   provides it; plugin loader/fiber phases are NEVER mapped onto connection
 *   status.
 * - Error payloads use the uniform `{ error: { code, message, details? } }`
 *   envelope and never echo credential material.
 *
 * @module @hanxu131/toolscontrol-dsh/shared/protocol
 */

/** Plugin identity; must equal the manifest `name`. */
export const PLUGIN_NAME = '@hanxu131/toolscontrol-dsh'

/** Plugin version; `tests/protocol.test.ts` keeps this in sync with package.json. */
export const PLUGIN_VERSION = '0.1.0'

/**
 * Route namespace this bundle claims on the DSH webServer. One `prefix`
 * registration covers every endpoint below.
 */
export const ROUTE_BASE = '/toolscontrol'

/** Static endpoints exposed by the host half on the DSH webServer. */
export const ROUTES = {
  /** Liveness + plugin identity; the one minimal-public route. */
  health: `${ROUTE_BASE}/health`,
  /** Read-only MCP + Skills overview snapshot (`?cwd=<workspace>`). */
  overview: `${ROUTE_BASE}/overview`,
  /** Explicit tool-name probe for ONE MCP server (POST; never automatic). */
  probe: `${ROUTE_BASE}/mcp/probe`,
} as const

// ---------------------------------------------------------------------------
// Warnings
// ---------------------------------------------------------------------------

/**
 * 结构化警告（向后兼容）：`warnings` 始终保留原始文本作为回退，本类型按
 * 同序给出可本地化的 code 与插值参数。客户端优先按 `t('warning.<code>',
 * params)` 渲染；`warningItems` 缺失、长度不齐或 code 未知时回退对应
 * `warnings` 原文。宿主产生的每个警告都必须同时提供 code 与 zh/en 文案。
 */
export interface WarningItem {
  /** 本地化键后缀（客户端拼为 `warning.<code>`）。 */
  code: string
  /** 文案插值参数（值只允许字符串/数字，绝不携带敏感信息）。 */
  params?: Record<string, string | number>
}

// ---------------------------------------------------------------------------
// MCP
// ---------------------------------------------------------------------------

/**
 * MCP 连接状态（CONTEXT.md「连接状态」）。
 *
 * - rc.5 降级环境恒为 `unknown`（官方管理服务不存在，连接情况不可观测）；
 * - 托管模式（未来环境）下为官方 `status.state` 字符串（官方 status 是以
 *   `state` 判别的对象联合；开放集合，官方新增状态不破坏本契约）；
 * - 官方返回畸形状态时防御为 `unknown`。
 */
export type McpConnectionStatus =
  | 'unknown'
  | 'disabled'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'failed'
  | 'waiting-credentials'
  | 'closed'
  | (string & {})

/**
 * MCP 条目来源（CONTEXT.md「来源可信度」）。仅在可靠时标注具体来源，
 * 否则保守标 `unknown`：当前两种模式（rc.5 pluginInventory 降级与官方
 * mcpManager 托管）都无法可靠确认条目所属作用域，恒为 `unknown`；
 * `global` 等具体来源保留给未来有可靠依据的官方信息。
 */
export type McpEntrySource = 'unknown' | 'global' | (string & {})

/** 本环境可提供的 MCP 观察能力（CONTEXT.md「能力不可用」）。 */
export interface McpCapabilities {
  /** 能否给出真实连接状态（rc.5: false，状态恒 unknown）。 */
  connectionStatus: boolean
  /** 能否给出已连接服务器的工具数量（rc.5: false）。 */
  toolCount: boolean
  /** 能否按名称显式探测工具（rc.5: false；探测永远只显式触发）。 */
  probe: boolean
}

/**
 * MCP 条目所属的 DSH 组合作用域（CONTEXT.md「来源」）。
 *
 * - `profile` — Desktop profile 根级 Loader 条目（pluginInventory `entries`）；
 * - `preset` — 某个 agent preset 组合内的条目（pluginInventory
 *   `agentPresets[].rows`，携带 `preset`）；preset 条目只在该组合内生效，
 *   绝不冒充全局配置；
 * - `unknown` — 官方托管服务只治理全局面、无法可靠判定时（托管模式）。
 */
export type McpEntryScope = 'profile' | 'preset' | 'unknown'

/**
 * preset 组合标识：`id` 稳定唯一（来自官方 `AgentPresetComposition.id`），
 * `name` 为官方展示名，可能缺省。同名条目出现在不同 preset 时靠它区分。
 */
export interface McpPresetRef {
  id: string
  name?: string
}

/**
 * 单条探测的不可用原因（稳定 code）。它不是连接状态：即使原因为
 * `config_unresolved`，条目的 `status` 仍可以是 `unknown` 或托管状态。
 */
export type McpProbeUnavailableReason =
  | 'disabled'
  | 'conditional'
  | 'config_missing'
  | 'config_unresolved'
  | 'unsupported_transport'
  | 'probe_unavailable'

/**
 * 独立探测能力（与 `capabilities.probe` 分离）。
 *
 * 探测是 Host 侧的短期、手动连接：它不读取也不改变 DSH 当前实例的
 * 连接状态，`config` 模式下 `connectionStatus` 仍为 false、条目 `status`
 * 仍为 unknown。`manualOnly` 恒 true，快照读取路径绝不触发探测。
 */
export interface McpProbeAvailability {
  /**
   * 探测入口是否可用：config 模式下至少一个配置组装面可读；托管模式下
   * 官方 `mcpManager.probe` 可用。与连接状态无关。
   */
  available: boolean
  /** 恒为 true：只有显式 POST 才会发起连接。 */
  manualOnly: true
  /** Host 全局并发上限（所有 probeKey 共享）。 */
  maxConcurrent: number
  /** 单条探测总预算（毫秒）。 */
  timeoutMs: number
  /** profile 根级 Loader 配置是否可读。 */
  profile: boolean
  /** agent preset 声明是否可读。 */
  presets: boolean
  /** `available===false` 时的稳定原因 code。 */
  reason?: 'config_source_unavailable' | 'runtime_unavailable' | (string & {})
}

/** 一个 MCP 条目（CONTEXT.md「已启用项/已禁用项/连接状态」）。 */
export interface McpServerEntry {
  /**
   * 条目标识：官方 mcpManager 存在时为服务器名称（serverName）；
   * rc.5 降级下为 Loader 条目标识（entryId，preset 行可能没有 entryId
   * 时回退 moduleName）。
   */
  name: string
  /** 配置层面启用与否（托管：state!=='disabled'；rc.5 来自 pluginInventory，可靠）。 */
  enabled: boolean
  /**
   * 条件启用：preset 行的 `disabled` 是表达式、静态无法求值。此时
   * `enabled` 只表示"未静态禁用"，界面必须显式标注条件启用。
   */
  conditional?: true
  /** 条目是否仍处于已配置状态（官方 manager 语义；rc.5 恒 true）。 */
  configured: boolean
  /** 连接状态：rc.5 恒 `unknown`；托管模式取官方 `status.state`；畸形防御为 `unknown`。 */
  status: McpConnectionStatus
  /** 工具数量：仅托管模式且 `state==='connected'` 时从官方 `status.toolCount` 读取。 */
  toolCount?: number
  /** 条目来源标注（保守：无法确认时为 `unknown`；当前恒 `unknown`）。 */
  source: McpEntrySource
  /** 所属 DSH 组合作用域（profile 根级 / preset / 不可判定）。 */
  scope: McpEntryScope
  /** `scope==='preset'` 时的 preset 标识；其它作用域不出现。 */
  preset?: McpPresetRef
  /**
   * 稳定探测键（不透明字符串）。包含作用域、presetId 与 entryId，
   * 同 preset 内重复/空 id 由 Host 稳定消歧；绝不使用展示名作为跨作用域
   * 唯一键。客户端原样回传该值发起单条显式探测。
   */
  probeKey: string
  /** 该条目当前是否可手动探测（仅真正启用的条目为 true）。 */
  probeAvailable: boolean
  /** 不可探测时的稳定原因（与连接状态无关）。 */
  probeUnavailableReason?: McpProbeUnavailableReason
}

/** `GET ${ROUTES.overview}` 中 MCP 部分的载荷。 */
export interface McpSnapshot {
  /**
   * 数据来源模式：
   * - `managed` — 官方 mcpManager 服务提供真实列表与状态；
   * - `config` — rc.5 降级：pluginInventory 只提供配置条目与启用状态；
   * - `unavailable` — 两个来源都不可用（见 warnings）。
   */
  mode: 'managed' | 'config' | 'unavailable'
  capabilities: McpCapabilities
  /**
   * 独立探测能力。与 `capabilities.probe`（托管管理服务自带的 probe）
   * 分离：rc.5 下 `capabilities.probe` 仍为 false，本字段可独立为 true。
   * 缺失时客户端必须按「探测不可用」处理（旧 Host 兼容）。
   */
  probe?: McpProbeAvailability
  /**
   * 是否完整读取了两个配置组装面（`entries` + `agentPresets[].rows`），
   * 因而足以断言“profile 根级与全部 presets 都没有 MCP server”。
   *
   * 仅 `mode==='config'` 的完整读取为 `true`；部分组装面/条目无法解析、
   * 另一来源读取失败或托管模式（只治理全局面）时都不提供该断言，界面
   * 必须退化为通用空态。判断依据是该显式标志，不是 warning 文案。
   */
  canAssertEmpty?: boolean
  servers: McpServerEntry[]
  /** 降级/部分失败说明（原始文本；不含敏感值，作为本地化回退）。 */
  warnings: string[]
  /** 与 `warnings` 同序的结构化警告（可选，缺失时客户端回退原文）。 */
  warningItems?: WarningItem[]
}

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------

/** 调用策略（CONTEXT.md「当前可见 Skills」：是否允许调用）。 */
export interface SkillInvocationPolicy {
  /** 模型目录/加载是否包含此 Skill。 */
  modelInvocable: boolean
  /** 人工命令目录/加载是否包含此 Skill。 */
  userInvocable: boolean
}

/**
 * 可见性：生效版本或被遮蔽版本（CONTEXT.md「生效 Skill/被遮蔽 Skill」）。
 *
 * 领域协议沿用「被遮蔽」；界面表述统一为「被覆盖 / Overridden」。
 */
export type SkillVisibility = 'effective' | 'shadowed'

/** 一个可见 Skill 条目（生效或被遮蔽）。 */
export interface SkillEntry {
  /** kebab-case 标识。 */
  name: string
  /** 短描述。 */
  description: string
  /** 额外路由指引（官方 frontmatter `whenToUse`）。 */
  whenToUse?: string
  /** 官方来源标签（project-dsh/project-agents/runtime/custom/user-dsh/user-agents/bundled/其他）。 */
  source: string
  /** 调用策略：生效项来自官方注册表；被遮蔽项来自只读 frontmatter 解析。 */
  invocation: SkillInvocationPolicy
  visibility: SkillVisibility
  /** 被遮蔽时：遮蔽它的生效版本的来源标签。 */
  shadowedBy?: string
  /** 指令文件绝对路径（生效项来自官方注册表；被遮蔽项来自只读扫描）。 */
  path?: string
}

/** `GET ${ROUTES.overview}` 中 Skills 部分的载荷。 */
export interface SkillsSnapshot {
  /** 项目级发现上下文（请求的 cwd）；未提供时为 null。 */
  cwd: string | null
  /** 可见范围：生效项 + 同名被遮蔽项（CONTEXT.md「当前可见 Skills」）。 */
  skills: SkillEntry[]
  /**
   * 枚举限制与单来源失败说明（原始文本，作为本地化回退）。被遮蔽版本
   * 不保证完整：运行时、preset 与自定义目录来源不可完整枚举——相关警告
   * 必须出现在这里。
   */
  warnings: string[]
  /** 与 `warnings` 同序的结构化警告（可选，缺失时客户端回退原文）。 */
  warningItems?: WarningItem[]
}

// ---------------------------------------------------------------------------
// Overview（聚合快照）
// ---------------------------------------------------------------------------

/** `GET ${ROUTES.overview}` 响应体：MCP + Skills 只读总览。 */
export interface OverviewSnapshot {
  plugin: string
  version: string
  /** 快照生成时间（ms epoch）。 */
  generatedAt: number
  mcp: McpSnapshot
  skills: SkillsSnapshot
}

// ---------------------------------------------------------------------------
// MCP 显式探测（POST ${ROUTES.probe}；单条、手动、短期连接，不改配置）
// ---------------------------------------------------------------------------

/** `POST ${ROUTES.probe}` 请求体：一次只探测一个条目。 */
export interface McpProbeRequest {
  /** 快照中该条目的稳定探测键（新客户端使用；优先于 `server`）。 */
  probeKey?: string
  /** 旧版托管探测：官方 mcpManager 的服务器名称（仅兼容保留）。 */
  server?: string
}

/**
 * 探测失败阶段 / 安全 code。Host 只返回这些固定分类，绝不回传原始错误
 * 文本（原始错误可能含 URL、凭据或路径）。
 */
export type McpProbeStage = 'connect' | 'tools_list' | 'timeout' | 'cancelled' | 'unavailable' | 'disabled'

/** 探测成功：供数量展示与工具名展开。 */
export interface McpProbeSuccess {
  ok: true
  probeKey: string
  scope: McpEntryScope
  /** `scope==='preset'` 时存在。 */
  presetId?: string
  /** Loader/声明条目标识；无声明 id 时为 null。 */
  entryId: string | null
  /** 工具列表读取完成时间（ms epoch；连接关闭随后在返回前完成）。 */
  probedAt: number
  /** 探测阶段耗时（毫秒；连接关闭的等待不计入该值）。 */
  durationMs: number
  /** 服务端返回的工具名（顺序保持；0 个工具是成功）。 */
  toolNames: string[]
  /** `toolNames.length` 的冗余字段，便于数量展示。 */
  toolCount: number
}

/** 探测失败：阶段 + 安全 code + 简短且脱敏的 message。 */
export interface McpProbeFailure {
  ok: false
  probeKey: string
  scope?: McpEntryScope
  presetId?: string
  entryId?: string | null
  /** 失败发生在哪个阶段（与 `code` 同值，独立表达便于 UI 分支）。 */
  stage: McpProbeStage
  code: McpProbeStage
  /** 固定文案，不含 URL/凭据/路径/原始错误。 */
  message: string
  /** 探测阶段耗时（毫秒；未能开始时为 0，连接关闭的等待不计入）。 */
  durationMs: number
}

/** `POST ${ROUTES.probe}` 响应体：成功含工具名，失败含阶段与安全 code。 */
export type McpProbeResponse = McpProbeSuccess | McpProbeFailure

// ---------------------------------------------------------------------------
// Health & error envelope
// ---------------------------------------------------------------------------

/** `GET ${ROUTES.health}` response body. */
export interface HealthResponse {
  ok: true
  plugin: string
  version: string
}

/** Machine-readable error codes surfaced over the wire. */
export type ErrorCode =
  | 'invalid_input'
  | 'not_found'
  | 'method_not_allowed'
  | 'unsupported_media_type'
  | 'payload_too_large'
  | 'service_unavailable'
  | 'internal'

/** Uniform error body for every non-2xx JSON response. */
export interface ErrorResponse {
  error: {
    code: ErrorCode
    /** Human-readable message; never contains credential material. */
    message: string
    details?: Record<string, unknown>
  }
}
