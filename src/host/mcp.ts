/**
 * MCP 只读聚合（CONTEXT.md「MCP」）。
 *
 * 双模式：
 * - `managed` — 官方 `ctx.mcpManager` 服务存在（未来环境）：透传真实
 *   列表与连接状态（官方 status 是以 `state` 判别的对象联合，wire 取
 *   `status.state` 字符串；toolCount 仅 connected 时从 status 内读取；
 *   畸形状态防御为 unknown + warning），probe 仅显式调用；
 * - `config` — rc.5 降级：`pluginInventory` 只提供配置条目与可靠的
 *   启用状态；连接状态恒为 `unknown`（CONTEXT.md「连接状态未知」——
 *   绝不从插件加载状态推断），能力全部标注不可用。
 *   `config` 合并官方 `list()` 的两处组装面：profile 根级 `entries` 与
 *   `agentPresets[].rows`（preset 组合，scope `preset`）。当前 DSH 的
 *   MCP 行可以只存在于 preset 组合内，只看根级会漏报。
 *
 * 两个来源都以可选晚绑定服务注入（`attachServices`）；都不存在或读取
 * 失败时快照降级为 `unavailable` + warning，绝不整体失败。
 *
 * 安全红线：快照只含聚合语义字段；条目携带的任何 env/headers/command/
 * URL/token 一律不进入 DTO（结构面类型上就未声明这些字段）。
 *
 * @module @hanxu131/toolscontrol-dsh/host/mcp
 */

import type { McpCapabilities, McpPresetRef, McpProbeResponse, McpSnapshot, McpServerEntry } from '../shared/protocol.ts'
import { errorMessage } from './services.ts'
import type { McpManagerFace, McpProbeOutcomeFace, McpManagedServerViewFace, PluginInventoryFace } from './services.ts'
import { warn, warningLog, type WarningLog } from './warnings.ts'

/** Loader 条目视作 MCP 配置项的模块名（官方包名与插件短名）。 */
const MCP_CLIENT_MODULES = new Set(['@deepseek-ai/dsh-mcp-client', 'mcp-client'])

/** 是否为 MCP 客户端配置条目（精确匹配，避免前缀/后缀误判）。 */
export function isMcpClientModule(moduleName: string): boolean {
  return MCP_CLIENT_MODULES.has(moduleName)
}

/** 官方行启用状态：boolean 或静态无法求值的 `'conditional'`。 */
function isMcpEnablement(value: unknown): value is boolean | 'conditional' {
  return value === true || value === false || value === 'conditional'
}

/** 晚绑定注入的服务集合。 */
export interface McpCatalogServices {
  inventory?: PluginInventoryFace
  manager?: McpManagerFace
}

/** rc.5 能力边界：连接状态不可观测，工具数量与探测不可用。 */
const DEGRADED_CAPABILITIES: McpCapabilities = { connectionStatus: false, toolCount: false, probe: false }

/** 只读 MCP 目录：聚合官方管理服务或（降级）插件清单。 */
export class McpCatalog {
  private inventory: PluginInventoryFace | undefined
  private manager: McpManagerFace | undefined

  constructor(services: McpCatalogServices = {}) {
    this.inventory = services.inventory
    this.manager = services.manager
  }

  /** 晚绑定：对应 `ctx.inject` effect 触发时挂上服务。 */
  attachServices(services: McpCatalogServices): void {
    if (services.inventory !== undefined) this.inventory = services.inventory
    if (services.manager !== undefined) this.manager = services.manager
  }

  /** 晚绑定：服务 cycle/卸载时摘除，回到降级路径。 */
  detachServices(names: readonly ('inventory' | 'manager')[]): void {
    for (const name of names) {
      if (name === 'inventory') this.inventory = undefined
      if (name === 'manager') this.manager = undefined
    }
  }

  /**
   * 当前 MCP 快照：官方管理服务优先；rc.5 走配置层降级。任何单来源
   * 失败都降级并携带 warning，不抛出。
   */
  async snapshot(): Promise<McpSnapshot> {
    if (this.manager !== undefined) return await this.managedSnapshot(this.manager)
    if (this.inventory !== undefined) return await this.configSnapshot(this.inventory)
    const warnings = warningLog()
    warn(warnings, 'mcp.inventoryUnavailable', undefined, 'pluginInventory 服务不可用：MCP 配置条目无法读取')
    return unavailableSnapshot(warnings)
  }

  /**
   * 显式工具探测（CONTEXT.md「工具探测」）：只按名称探测，不改任何配置，
   * 也不会被快照等读取路径自动触发。rc.5 无官方管理服务 → 能力不可用。
   */
  async probe(server: string): Promise<McpProbeResponse> {
    const manager = this.manager
    if (manager === undefined || typeof manager.probe !== 'function') {
      return {
        ok: false,
        code: 'probe_unavailable',
        message: '当前 Desktop 版本没有可用的 MCP 管理服务，无法探测工具',
      }
    }
    let outcome: McpProbeOutcomeFace
    try {
      outcome = await manager.probe(server)
    } catch (error) {
      return { ok: false, code: 'probe_failed', message: errorMessage(error) }
    }
    if (typeof outcome === 'object' && outcome !== null && (outcome as { ok?: unknown }).ok === true) {
      const toolNames = (outcome as { toolNames?: unknown }).toolNames
      if (!Array.isArray(toolNames)) {
        return { ok: false, code: 'probe_failed', message: 'probe 返回了无法解析的结果' }
      }
      return { ok: true, toolNames: toolNames.map((name) => String(name)) }
    }
    if (
      typeof outcome === 'object' && outcome !== null && (outcome as { ok?: unknown }).ok === false &&
      typeof (outcome as { stage?: unknown }).stage === 'string' &&
      typeof (outcome as { message?: unknown }).message === 'string'
    ) {
      const failure = outcome as { stage: string; message: string }
      return { ok: false, code: 'probe_failed', message: failure.message, stage: failure.stage }
    }
    return { ok: false, code: 'probe_failed', message: 'probe 返回了无法解析的结果' }
  }

  /**
   * rc.5 降级：配置条目 + 可靠启用状态；连接状态恒 unknown。
   *
   * 数据源是官方 `pluginInventory.list()` 的**全部**组装面：
   * - `entries` — profile 根级非 group Loader 条目（scope `profile`）；
   * - `agentPresets[].rows` — 每个 agent preset 组合内声明的行
   *   （scope `preset` + preset 标识）。当前 DSH 的会话 preset 层才是
   *   模型可见插件真正运行的位置，只看根级会漏掉 preset-only 的 MCP。
   *
   * 去重规则：同一 `(scope, preset.id, 名称)` 只保留首条（名称取
   * `entryId`，preset 行没有 entryId 时回退 `moduleName`）；不同作用域
   * 的同名条目**不是**重复——它们属于不同组合，必须分别展示。
   * 畸形数据（agentPresets 非数组、preset 缺 id / rows 非数组、行无法
   * 解析）逐项降级并给出 warning，绝不拖垮整个快照。
   */
  private async configSnapshot(inventory: PluginInventoryFace, extraWarnings: WarningLog = warningLog()): Promise<McpSnapshot> {
    let snapshot: unknown
    try {
      snapshot = await inventory.list()
    } catch (error) {
      warn(extraWarnings, 'mcp.inventoryReadFailed', { message: errorMessage(error) }, `pluginInventory 读取失败：${errorMessage(error)}`)
      return unavailableSnapshot(extraWarnings)
    }
    const warnings: WarningLog = extraWarnings
    const servers: McpServerEntry[] = []
    const seen = new Set<string>()
    let duplicates = 0
    let invalidRows = 0
    let invalidEnabledRows = 0
    // 只有完整读取 entries 与 agentPresets[].rows 两个组装面，才能断言
    // “没有 MCP server”。任何一项解析失败/被跳过都置 false；重复条目
    // 只是去重、不丢失空态结论，因此不在此列。
    let complete = extraWarnings.warnings.length === 0

    const addRow = (raw: unknown, scope: 'profile' | 'preset', preset?: McpPresetRef): void => {
      if (typeof raw !== 'object' || raw === null) {
        invalidRows += 1
        complete = false
        return
      }
      const row = raw as { entryId?: unknown; moduleName?: unknown; enabled?: unknown }
      if (typeof row.moduleName !== 'string') {
        invalidRows += 1
        complete = false
        return
      }
      if (!isMcpClientModule(row.moduleName)) return
      // enabled 只接受官方 boolean 或静态无法求值的 'conditional'；
      // 缺失/其它类型不能默认成 true（会伪造“已启用”结论）。
      const enabled = row.enabled
      if (!isMcpEnablement(enabled)) {
        invalidEnabledRows += 1
        complete = false
        return
      }
      const name = typeof row.entryId === 'string' && row.entryId !== '' ? row.entryId : row.moduleName
      const key = `${scope}\u0000${preset?.id ?? ''}\u0000${name}`
      if (seen.has(key)) {
        duplicates += 1
        return
      }
      seen.add(key)
      // preset 行的 disabled 可能是表达式（官方 `'conditional'`）：静态
      // 无法求值，只能标注“条件启用”，不能假装已静态启用/禁用。
      const conditional = enabled === 'conditional'
      servers.push({
        name,
        enabled: conditional ? true : enabled,
        ...(conditional ? { conditional: true as const } : {}),
        configured: true,
        status: 'unknown',
        source: 'unknown',
        scope,
        ...(preset !== undefined ? { preset } : {}),
      })
    }

    const record = typeof snapshot === 'object' && snapshot !== null ? (snapshot as Record<string, unknown>) : undefined
    if (record === undefined) {
      warn(warnings, 'mcp.inventoryUnparsable', undefined, 'pluginInventory 返回了无法解析的清单结果')
      complete = false
    }

    const entries = record?.entries
    if (!Array.isArray(entries)) {
      warn(
        warnings,
        'mcp.entriesUnparsable',
        undefined,
        'pluginInventory 未返回可解析的 entries 列表，已跳过 profile 根级条目',
      )
      complete = false
    } else {
      for (const entry of entries) addRow(entry, 'profile')
    }

    const presets = record?.agentPresets
    if (presets !== undefined && presets !== null) {
      if (!Array.isArray(presets)) {
        warn(
          warnings,
          'mcp.presetsUnparsable',
          undefined,
          'pluginInventory 的 agentPresets 无法解析，已仅统计 profile 根级 MCP 条目',
        )
        complete = false
      } else {
        presets.forEach((raw, index) => {
          const preset = parsePreset(raw, index, warnings)
          if (preset === undefined) {
            complete = false
            return
          }
          if (preset.incomplete === true) complete = false
          for (const row of preset.rows) addRow(row, 'preset', preset.ref)
        })
      }
    }

    if (invalidEnabledRows > 0) {
      warn(
        warnings,
        'mcp.invalidEnabledRows',
        { n: invalidEnabledRows },
        `pluginInventory 返回了 ${invalidEnabledRows} 条 enabled 无法解析的 MCP 条目，已跳过`,
      )
    }
    if (invalidRows > 0) {
      warn(
        warnings,
        'mcp.invalidRows',
        { n: invalidRows },
        `pluginInventory 返回了 ${invalidRows} 条无法解析的插件条目，已跳过`,
      )
    }
    if (duplicates > 0) {
      warn(
        warnings,
        'mcp.duplicates',
        { n: duplicates },
        `已忽略 ${duplicates} 条重复的 MCP 条目（同一 profile/preset 作用域内同名条目只保留首条；不同作用域的同名条目不算重复）`,
      )
    }
    return {
      mode: 'config',
      capabilities: DEGRADED_CAPABILITIES,
      canAssertEmpty: complete,
      servers,
      warnings: warnings.warnings,
      warningItems: warnings.warningItems,
    }
  }

  /** 官方 mcpManager 存在：透传真实状态（status.state 字符串）；畸形防御。 */
  private async managedSnapshot(manager: McpManagerFace): Promise<McpSnapshot> {
    let views: readonly McpManagedServerViewFace[]
    try {
      views = await manager.list()
    } catch (error) {
      const failure = warningLog()
      warn(failure, 'mcp.managerReadFailed', { message: errorMessage(error) }, `mcpManager 读取失败：${errorMessage(error)}`)
      if (this.inventory !== undefined) return await this.configSnapshot(this.inventory, failure)
      return unavailableSnapshot(failure)
    }
    const capabilities: McpCapabilities = {
      connectionStatus: true,
      toolCount: true,
      probe: typeof manager.probe === 'function',
    }
    const warnings = warningLog()
    const servers: McpServerEntry[] = views.map((view) => {
      const status: unknown = view.status
      // 官方 status 是以 state 判别的对象联合；畸形输入按 unknown 防御，
      // 不让单个条目拖垮快照。
      if (typeof status === 'object' && status !== null && typeof (status as { state?: unknown }).state === 'string') {
        const state = (status as { state: string }).state
        const toolCount = (status as { toolCount?: unknown }).toolCount
        return {
          name: view.name,
          enabled: state !== 'disabled',
          configured: view.configured !== false,
          status: state,
          // 有限数才进入 DTO：NaN/Infinity（JSON 无法表达）一律排除。
          ...(state === 'connected' && typeof toolCount === 'number' && Number.isFinite(toolCount)
            ? { toolCount }
            : {}),
          source: 'unknown',
          // 官方 manager 只治理全局面，没有可靠的 preset 归属信息。
          scope: 'unknown',
        }
      }
      warn(
        warnings,
        'mcp.statusUnparsable',
        { name: view.name },
        `MCP 条目 ${view.name} 返回了无法解析的状态，已按 unknown 处理`,
      )
      return {
        name: view.name,
        enabled: true,
        configured: view.configured !== false,
        status: 'unknown',
        source: 'unknown',
        scope: 'unknown',
      }
    })
    return { mode: 'managed', capabilities, servers, warnings: warnings.warnings, warningItems: warnings.warningItems }
  }
}

/** 一条解析后的 preset 组合（畸形数据在解析时降级并写入 warnings）。 */
interface ParsedPreset {
  ref: McpPresetRef
  rows: readonly unknown[]
  /** preset 组合加载失败：其声明行仍展示，但不能据此断言“没有 MCP”。 */
  incomplete?: true
}

/**
 * 解析官方 `AgentPresetComposition` 的消费子集。缺 id / rows 非数组 /
 * 条目非对象都只跳过该 preset（并给出 warning），不拖垮快照。
 */
function parsePreset(raw: unknown, index: number, warnings: WarningLog): ParsedPreset | undefined {
  if (typeof raw !== 'object' || raw === null) {
    warn(
      warnings,
      'mcp.presetInvalid',
      { index: index + 1 },
      `pluginInventory 返回了无法解析的 preset 条目（第 ${index + 1} 项），已跳过`,
    )
    return
  }
  const value = raw as Record<string, unknown>
  if (typeof value.id !== 'string' || value.id === '') {
    warn(
      warnings,
      'mcp.presetNoId',
      { index: index + 1 },
      `pluginInventory 返回了缺少 id 的 preset 条目（第 ${index + 1} 项），已跳过`,
    )
    return
  }
  const ref: McpPresetRef = {
    id: value.id,
    ...(typeof value.name === 'string' && value.name !== '' ? { name: value.name } : {}),
  }
  const label = ref.name ?? ref.id
  const incomplete = value.broken !== undefined
  if (incomplete) {
    if (typeof value.broken === 'string' && value.broken !== '') {
      warn(
        warnings,
        'mcp.presetBroken',
        { label, reason: value.broken },
        `preset「${label}」组合加载失败，其中条目可能不完整：${value.broken}`,
      )
    } else {
      warn(
        warnings,
        'mcp.presetBrokenNoReason',
        { label },
        `preset「${label}」组合加载失败，其中条目可能不完整：未知原因`,
      )
    }
  }
  if (!Array.isArray(value.rows)) {
    warn(
      warnings,
      'mcp.presetRowsUnparsable',
      { label },
      `preset「${label}」的条目列表无法解析，已跳过该 preset 的组合行`,
    )
    return
  }
  return { ref, rows: value.rows, ...(incomplete ? { incomplete: true as const } : {}) }
}

/** 双来源都不可用或读取失败的统一降级快照。 */
function unavailableSnapshot(warnings: WarningLog): McpSnapshot {
  return {
    mode: 'unavailable',
    capabilities: DEGRADED_CAPABILITIES,
    servers: [],
    warnings: warnings.warnings,
    warningItems: warnings.warningItems,
  }
}
