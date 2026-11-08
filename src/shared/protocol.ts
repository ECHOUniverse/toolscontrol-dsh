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
// MCP 显式探测（POST ${ROUTES.probe}；仅名称，不改任何配置）
// ---------------------------------------------------------------------------

/** `POST ${ROUTES.probe}` 请求体。 */
export interface McpProbeRequest {
  /** 目标 MCP 条目标识（与快照中的 `name` 一致）。 */
  server: string
}

/** `POST ${ROUTES.probe}` 响应体：成功含工具名，失败含阶段与原因。 */
export type McpProbeResponse =
  | { ok: true; toolNames: string[] }
  | {
      ok: false
      code: 'probe_unavailable' | 'probe_failed' | 'invalid_input'
      message: string
      /** 失败阶段（官方 probe 语义；可用时存在）。 */
      stage?: string
    }

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
