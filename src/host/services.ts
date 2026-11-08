/**
 * Structural faces of the DSH host services this plugin consumes, typed
 * locally instead of imported.
 *
 * Rationale: composition services live in sibling Cordis fibers and are only
 * readable from a fiber that declared them, so `apply` consumes everything
 * through per-capability `ctx.inject(deps, callback)` effects; each face
 * declares ONLY the fields this plugin legitimately consumes — the MCP
 * inventory face deliberately omits `fiberPhase` so no code path can mistake
 * a loader phase for a connection status.
 *
 * The official `mcpManager` service does not exist in Desktop 0.2.1-rc.5; its
 * face is a structural type for FUTURE environments and is consumed only via
 * the optional late-bound `ctx.inject(['mcpManager'], …)` effect. No unreleased
 * package is ever imported, so rc.5 loading cannot fail.
 *
 * @module @hanxu131/toolscontrol-dsh/host/services
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { SkillInvocationPolicy } from '../shared/protocol.ts'

/** Minimal `register` face of `@deepseek-ai/dsh-host-webserver` (`WebServer.register`). */
export interface WebServerFace {
  register(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
  }): () => void
}

/**
 * Minimal trust/authentication face of `@deepseek-ai/dsh-client-connection`
 * (`HostConnectionHandle.requestRejection`): returns the HTTP status that
 * refuses the request, or `undefined` when the request may proceed.
 */
export interface TrustHeaders {
  readonly headers: IncomingMessage['headers'] | Record<string, string | string[] | undefined>
}

export interface ConnectionFace {
  requestRejection(request: TrustHeaders): 401 | 403 | undefined
}

// ---------------------------------------------------------------------------
// pluginInventory（rc.5 已存在；MCP 配置层降级来源）
// ---------------------------------------------------------------------------

/**
 * One Loader entry as this plugin legitimately consumes it. The official
 * inventory rows carry additional fields (fiber phase, display metadata);
 * they are deliberately NOT declared here so no code path can read them.
 */
export interface PluginInventoryEntryFace {
  /** Loader 条目标识（rc.5 降级下用作 MCP 条目名）。 */
  entryId: string
  /** 插件模块名（`@deepseek-ai/dsh-mcp-client` 或短名 `mcp-client`）。 */
  moduleName: string
  /** 配置层面启用与否（可靠）。 */
  enabled: boolean
}

/**
 * One row of an agent-preset composition, as `pluginInventory.list()`
 * projects it (`AgentPresetCompositionRow` with the fiber state swapped for
 * `fiberPhase`). `entryId` is `string | null` in the official type — preset
 * rows are declared in YAML and need not have a Loader entry id.
 * `enabled` is `CompositionRowEnablement` (`boolean | 'conditional'`): a row
 * whose `disabled` is a JsExpr cannot be resolved statically.
 */
export interface PluginInventoryPresetRowFace {
  entryId: string | null
  moduleName: string
  enabled: boolean | 'conditional'
}

/**
 * One composed agent-preset roster entry (`AgentPresetComposition` subset).
 * `broken` is the official activation diagnostic; its rows are still the
 * declared composition.
 */
export interface PluginInventoryPresetFace {
  id: string
  name?: string
  isDefault?: boolean
  broken?: string
  rows: readonly PluginInventoryPresetRowFace[]
}

/**
 * Official `pluginInventory.list()` result (`readPluginInventory`): the
 * profile root Loader entries plus, when an agent-preset roster is composed,
 * each preset's composition rows. Preset rows are where a deployment that
 * mounts the roster actually runs model-facing plugins — ignoring them hides
 * every MCP server configured only inside a preset.
 */
export interface PluginInventorySnapshotFace {
  entries: readonly PluginInventoryEntryFace[]
  agentPresets?: readonly PluginInventoryPresetFace[]
}

export interface PluginInventoryFace {
  list(): Promise<PluginInventorySnapshotFace>
}

// ---------------------------------------------------------------------------
// mcpManager（未来环境；结构类型，rc.5 不存在）
// ---------------------------------------------------------------------------

/**
 * Official managed-server status: an OBJECT union discriminated by `state`
 * (verified against official master `McpManagedServerStatus`:
 * `{state:'connected',toolCount,connectedAt}` / `{state:'disabled'}` /
 * `{state:'reconnecting',…}` / `{state:'failed',reason,…}` / …). Only the
 * fields this plugin consumes are declared; the union carries additional
 * official fields (attempt, connectedAt, lastError, …) under the index
 * signature, and malformed values are narrowed defensively at runtime.
 */
export interface McpStatusFace {
  state: string
  /** Only present when `state === 'connected'` (registered tools in the live generation). */
  toolCount?: number
  [field: string]: unknown
}

/**
 * One managed server view of the official `McpServerManager`
 * (`{name, configured, status}`; `status` is the object union above, NOT a
 * string — the wire string is derived from `status.state`).
 */
export interface McpManagedServerViewFace {
  name: string
  configured: boolean
  status: McpStatusFace
}

/**
 * Probe outcome of the official manager: success carries tool names, failure
 * carries stage + message. Declared per the official master semantics;
 * validated defensively at runtime.
 */
export type McpProbeOutcomeFace =
  | { ok: true; toolNames: readonly string[] }
  | { ok: false; stage: string; message: string }

export interface McpManagerFace {
  list(): Promise<readonly McpManagedServerViewFace[]>
  probe?(server: string): Promise<McpProbeOutcomeFace>
}

// ---------------------------------------------------------------------------
// skills（rc.5 已存在；dsh-skill 注册表）
// ---------------------------------------------------------------------------

/** 生效 Skill 摘要（官方 `SkillSummary` 的消费子集）。 */
export interface SkillSummaryFace {
  path?: string
  name: string
  description: string
  whenToUse?: string
  invocation: SkillInvocationPolicy
  source: string
  provider: string
}

/**
 * `ctx.skills` 注册表读面（官方 `SkillRegistry.list` / `SkillViewOptions`）。
 * `scope` 是会话观看层：官方对 scope 链与全局层做合并；省略即只看全局层。
 */
export interface SkillsRegistryFace {
  list(options?: { cwd?: string; scope?: object }): Promise<readonly SkillSummaryFace[]>
}

/**
 * 一个 live Agent 的最小结构面（官方 `ctx.agents.get(sessionId)` 的返回值）。
 * 同一个对象同时作为 `skills.list({scope})` 的 scope carrier —— 本插件不读
 * Agent 的其它字段；`ctx` 仅供官方 `agentPresets.serviceFor` 定位 preset
 * 组合，插件自身从不检查它。
 */
export interface AgentFace {
  readonly id: string
  readonly ctx?: unknown
}

/** `ctx.agents` 读面：按 SessionId 查找 live Agent。 */
export interface AgentsFace {
  get(id: string): AgentFace | undefined
}

/**
 * `ctx.agentPresets` 读面：解析 live Agent 所在 preset 组合内挂载的
 * `skills` 服务。preset 可以隔离出自己的 skills registry，因此官方
 * session catalog 优先用它，找不到才回退宿主 `ctx.skills`。
 */
export interface AgentPresetsFace {
  serviceFor(agent: AgentFace, name: 'skills'): SkillsRegistryFace | undefined
}

// ---------------------------------------------------------------------------
// 服务集合（急切接缝；生产路径走 ctx.inject 晚绑定）
// ---------------------------------------------------------------------------

/** A Cordis context as this plugin reads it: services looked up defensively. */
export interface HostServices {
  webServer?: WebServerFace
  connection?: ConnectionFace
  pluginInventory?: PluginInventoryFace
  mcpManager?: McpManagerFace
  skills?: SkillsRegistryFace
  agents?: AgentsFace
  agentPresets?: AgentPresetsFace
}

/** Read the plugin-facing services off a Cordis host context, defensively. */
export function servicesOf(ctx: unknown): HostServices {
  const source = ctx as Record<string, unknown>
  const face = <T>(name: string): T | undefined => {
    const value = Reflect.get(source, name)
    return (value !== null && typeof value === 'object') || typeof value === 'function' ? (value as T) : undefined
  }
  return {
    webServer: face<WebServerFace>('webServer'),
    connection: face<ConnectionFace>('connection'),
    pluginInventory: face<PluginInventoryFace>('pluginInventory'),
    mcpManager: face<McpManagerFace>('mcpManager'),
    skills: face<SkillsRegistryFace>('skills'),
    agents: face<AgentsFace>('agents'),
    agentPresets: face<AgentPresetsFace>('agentPresets'),
  }
}

/**
 * Read one composition service off a Cordis context. Callers must guarantee
 * availability (inside a `ctx.inject` callback whose deps include the name) —
 * Cordis throws when no fiber in the ancestor chain declared and received it.
 */
export function serviceOf<T>(ctx: unknown, name: string): T {
  const value: unknown = Reflect.get(ctx as Record<string, unknown>, name)
  if (value === null || value === undefined || (typeof value !== 'object' && typeof value !== 'function')) {
    throw new Error(`composition service "${name}" is not readable from this fiber`)
  }
  return value as T
}

/** Readable message of any thrown value (for warnings; never credential material). */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
