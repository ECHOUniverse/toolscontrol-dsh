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
 *   绝不从插件加载状态推断），`capabilities` 仍标注不可用；独立探测
 *   能力单独由 `probe` 字段表达。
 *   `config` 合并官方 `list()` 的两处组装面：profile 根级 `entries` 与
 *   `agentPresets[].rows`（preset 组合，scope `preset`）。当前 DSH 的
 *   MCP 行可以只存在于 preset 组合内，只看根级会漏报。
 *
 * 两个来源都以可选晚绑定服务注入（`attachServices`）；都不存在或读取
 * 失败时快照降级为 `unavailable` + warning，绝不整体失败。
 *
 * 独立探测（`probeKey` / `probeByKey`）只读取配置并在显式调用时建立
 * 一次短期连接；它不改变连接状态字段，快照读取路径绝不触发连接。
 *
 * 安全红线：快照只含聚合语义字段；条目携带的任何 env/headers/command/
 * URL/token 一律不进入 DTO（结构面类型上就未声明这些字段）。
 *
 * @module @hanxu131/toolscontrol-dsh/host/mcp
 */

import type {
  McpCapabilities,
  McpPresetRef,
  McpProbeAvailability,
  McpProbeResponse,
  McpProbeStage,
  McpSnapshot,
  McpServerEntry,
} from '../shared/protocol.ts'
import { errorMessage } from './services.ts'
import type {
  AgentPresetsFace,
  LoaderFace,
  McpManagerFace,
  McpProbeOutcomeFace,
  McpManagedServerViewFace,
  PluginInventoryFace,
} from './services.ts'
import { isMcpClientModule, McpProbeConfigReader, probeKeyForEntry, type ProbeCandidate, type ProbeConfigCollection, type ProbeConfigReaderFace } from './mcp-config.ts'
import { McpProbeService, type McpProbeRuntimeOptions } from './mcp-probe.ts'
import { warn, warningLog, type WarningLog } from './warnings.ts'

export { isMcpClientModule } from './mcp-config.ts'

/** 官方行启用状态：boolean 或静态无法求值的 `'conditional'`。 */
function isMcpEnablement(value: unknown): value is boolean | 'conditional' {
  return value === true || value === false || value === 'conditional'
}

/** 晚绑定注入的服务集合。 */
export interface McpCatalogServices {
  inventory?: PluginInventoryFace
  manager?: McpManagerFace
  /** profile 根级配置读面（探测用；缺失只降级探测）。 */
  loader?: LoaderFace
  /** agent preset 声明读面（探测用；缺失只降级探测）。 */
  presets?: AgentPresetsFace
  /** 测试接缝：直接提供探测配置读取器。 */
  probeReader?: ProbeConfigReaderFace
  /** 测试接缝：并发/超时/连接器覆盖。 */
  probeRuntime?: McpProbeRuntimeOptions
}

/** rc.5 能力边界：连接状态不可观测，工具数量与探测不可用。 */
const DEGRADED_CAPABILITIES: McpCapabilities = { connectionStatus: false, toolCount: false, probe: false }

/** 只读 MCP 目录：聚合官方管理服务或（降级）插件清单。 */
export class McpCatalog {
  private inventory: PluginInventoryFace | undefined
  private manager: McpManagerFace | undefined
  private readonly configReader: McpProbeConfigReader
  private readonly reader: ProbeConfigReaderFace
  private readonly probeService: McpProbeService

  constructor(services: McpCatalogServices = {}) {
    this.inventory = services.inventory
    this.manager = services.manager
    this.configReader = new McpProbeConfigReader({
      ...(services.loader !== undefined ? { loader: services.loader } : {}),
      ...(services.presets !== undefined ? { presets: services.presets } : {}),
    })
    this.reader = services.probeReader ?? this.configReader
    this.probeService = new McpProbeService(this.reader, services.probeRuntime)
  }

  /** 晚绑定：对应 `ctx.inject` effect 触发时挂上服务。 */
  attachServices(services: McpCatalogServices): void {
    if (services.inventory !== undefined) this.inventory = services.inventory
    if (services.manager !== undefined) this.manager = services.manager
    this.configReader.attachServices({
      ...(services.loader !== undefined ? { loader: services.loader } : {}),
      ...(services.presets !== undefined ? { presets: services.presets } : {}),
    })
    // 配置面变化：立即丢弃探测配置缓存，不等 TTL。
    this.probeService.invalidateConfig()
  }

  /** 晚绑定：服务 cycle/卸载时摘除，回到降级路径。 */
  detachServices(names: readonly ('inventory' | 'manager' | 'loader' | 'presets')[]): void {
    for (const name of names) {
      if (name === 'inventory') this.inventory = undefined
      if (name === 'manager') this.manager = undefined
    }
    this.configReader.detachServices(names.filter((name): name is 'loader' | 'presets' => name === 'loader' || name === 'presets'))
    this.probeService.invalidateConfig()
  }

  /** 插件 dispose：中止在途探测并等待连接关闭。 */
  disposeProbes(): Promise<void> {
    return this.probeService.dispose()
  }

  /** 探测配置面不可读时的统一能力声明。 */
  private unavailableProbe(): McpProbeAvailability {
    return {
      available: false,
      manualOnly: true,
      maxConcurrent: this.probeService.maxConcurrent,
      timeoutMs: this.probeService.timeoutMs,
      profile: false,
      presets: false,
      reason: 'config_source_unavailable',
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
    return unavailableSnapshot(warnings, this.unavailableProbe())
  }

  /**
   * 显式单条探测（新契约）：只接受快照给出的稳定 `probeKey`。旧版
   * `managed:<name>` 键继续走官方 mcpManager，保持托管路径兼容。
   */
  probeByKey(probeKey: string, options: { signal?: AbortSignal } = {}): Promise<McpProbeResponse> {
    if (probeKey.startsWith('managed:')) {
      let name: string
      try {
        name = decodeURIComponent(probeKey.slice('managed:'.length))
      } catch {
        return Promise.resolve(this.probeFailure(probeKey, 'unavailable', '未找到该探测键对应的条目（配置可能已变化）', 0))
      }
      return this.probeManaged(name, options.signal)
    }
    return this.probeService.probe(probeKey, options)
  }

  /**
   * 旧版按名称探测（托管路径兼容）：官方 mcpManager 存在时转发；失败
   * 只返回固定分类与脱敏文案，绝不透传原始错误。
   */
  probe(server: string, options: { signal?: AbortSignal } = {}): Promise<McpProbeResponse> {
    return this.probeManaged(server, options.signal)
  }

  /**
   * 托管路径（官方 `mcpManager.probe`）：与独立探测共用同一套限制——
   * 全局并发 2、单条 10s 预算、调用者取消、dispose。
   *
   * 已知限制：官方 `probe(server)` 没有 AbortSignal 参数，**底层不可
   * 取消**。因此调用者取消/超时时本插件只保证本地响应立即返回、槽位与
   * dispose 语义正确；官方连接会自行继续到它自己的超时。
   */
  private probeManaged(server: string, signal: AbortSignal | undefined): Promise<McpProbeResponse> {
    const probeKey = probeKeyForEntry('unknown', server)
    const manager = this.manager
    if (manager === undefined || typeof manager.probe !== 'function') {
      return Promise.resolve(this.probeFailure(probeKey, 'unavailable', '当前 Desktop 版本没有可用的 MCP 管理服务，无法探测工具', 0))
    }
    const invoke = manager.probe.bind(manager)
    return this.probeService.execute(probeKey, signal !== undefined ? { signal } : {}, async (budget) => {
      // 与独立探测共用同一个全局并发槽；槽位在本地 settle 时释放，即使
      // 官方 probe 不可取消、仍在后台继续，也不会永久占用槽位。
      const releaseSlot = await budget.acquireSlot()
      if (releaseSlot === undefined) {
        const stage = budget.abortStage()
        return this.probeFailure(probeKey, stage, stageMessage(stage), budget.elapsed())
      }
      let outcome: McpProbeOutcomeFace
      try {
        outcome = await budget.race(Promise.resolve().then(() => invoke(server)))
      } catch {
        const stage = budget.signal.aborted || budget.remaining() <= 0 ? budget.abortStage() : 'connect'
        return this.probeFailure(probeKey, stage, stageMessage(stage), budget.elapsed())
      } finally {
        releaseSlot()
      }
      // 防御：超过预算或已取消时绝不把迟到的结果当成功返回。
      if (budget.signal.aborted || budget.remaining() <= 0) {
        const stage = budget.abortStage()
        return this.probeFailure(probeKey, stage, stageMessage(stage), budget.elapsed())
      }
      if (typeof outcome === 'object' && outcome !== null && (outcome as { ok?: unknown }).ok === true) {
        const toolNames = (outcome as { toolNames?: unknown }).toolNames
        if (!Array.isArray(toolNames)) {
          return this.probeFailure(probeKey, 'tools_list', '已连接，但读取工具列表失败', budget.elapsed())
        }
        return {
          ok: true,
          probeKey,
          scope: 'unknown',
          entryId: null,
          probedAt: Date.now(),
          durationMs: budget.elapsed(),
          toolNames: toolNames.map((name) => String(name)),
          toolCount: toolNames.length,
        }
      }
      const stage = typeof outcome === 'object' && outcome !== null ? (outcome as { stage?: unknown }).stage : undefined
      const code = managerStage(typeof stage === 'string' ? stage : '')
      return this.probeFailure(probeKey, code, stageMessage(code), budget.elapsed())
    })
  }

  private probeFailure(probeKey: string, code: McpProbeStage, message: string, durationMs: number): McpProbeResponse {
    return {
      ok: false,
      probeKey,
      scope: 'unknown',
      entryId: null,
      stage: code,
      code,
      message,
      durationMs,
    }
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
      return unavailableSnapshot(extraWarnings, this.unavailableProbe())
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
        probeKey: probeKeyForEntry(scope, name, preset?.id),
        probeAvailable: false,
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
    return await this.withConfigProbeInfo({
      mode: 'config',
      capabilities: DEGRADED_CAPABILITIES,
      canAssertEmpty: complete,
      servers,
      warnings: warnings.warnings,
      warningItems: warnings.warningItems,
    })
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
      return unavailableSnapshot(failure, this.unavailableProbe())
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
          probeKey: probeKeyForEntry('unknown', view.name),
          probeAvailable: false,
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
        probeKey: probeKeyForEntry('unknown', view.name),
        probeAvailable: false,
      }
    })
    return this.withManagedProbeInfo({ mode: 'managed', capabilities, servers, warnings: warnings.warnings, warningItems: warnings.warningItems }, typeof manager.probe === 'function')
  }

  /**
   * 配置快照附加独立探测信息（配置读取失败/超时只降级探测，不动服务器
   * 列表与总览）。读取走探测服务的 single-flight + 短 TTL + 硬上界
   * （默认 2s），因此总览绝不会被挂住的配置读取拖垮。
   */
  private async withConfigProbeInfo(snapshot: McpSnapshot): Promise<McpSnapshot> {
    let collection: ProbeConfigCollection
    try {
      collection = await this.probeService.collectConfig()
    } catch {
      return this.withUnavailableProbeInfo(snapshot)
    }
    const candidates = new Map<string, ProbeCandidate>()
    for (const candidate of collection.candidates) {
      const key = candidateIdentity(candidate.scope, candidate.preset?.id, candidate.name)
      if (!candidates.has(key)) candidates.set(key, candidate)
    }
    const servers = snapshot.servers.map((server) => {
      const candidate = candidates.get(candidateIdentity(server.scope, server.preset?.id, server.name))
      if (candidate !== undefined) {
        return {
          ...server,
          probeKey: candidate.probeKey,
          probeAvailable: candidate.probeAvailable,
          ...(candidate.probeAvailable ? {} : { probeUnavailableReason: candidate.probeUnavailableReason ?? 'probe_unavailable' }),
        }
      }
      return {
        ...server,
        probeKey: probeKeyForEntry(server.scope, server.name, server.preset?.id),
        probeAvailable: false as const,
        probeUnavailableReason: 'probe_unavailable' as const,
      }
    })
    return {
      ...snapshot,
      servers,
      probe: {
        available: collection.available,
        manualOnly: true,
        maxConcurrent: this.probeService.maxConcurrent,
        timeoutMs: this.probeService.timeoutMs,
        profile: collection.profile,
        presets: collection.presets,
        ...(collection.reason !== undefined ? { reason: collection.reason } : {}),
      },
    }
  }

  /** 探测配置面完全不可读：条目保留稳定（但不可用）的探测键。 */
  private withUnavailableProbeInfo(snapshot: McpSnapshot): McpSnapshot {
    return {
      ...snapshot,
      servers: snapshot.servers.map((server) => ({
        ...server,
        probeKey: probeKeyForEntry(server.scope, server.name, server.preset?.id),
        probeAvailable: false as const,
        probeUnavailableReason: 'probe_unavailable' as const,
      })),
      probe: {
        available: false,
        manualOnly: true,
        maxConcurrent: this.probeService.maxConcurrent,
        timeoutMs: this.probeService.timeoutMs,
        profile: false,
        presets: false,
        reason: 'config_source_unavailable',
      },
    }
  }

  /** 托管快照的探测键只用于旧版按名称探测（官方 mcpManager）。 */
  private withManagedProbeInfo(snapshot: McpSnapshot, canProbe: boolean): McpSnapshot {
    return {
      ...snapshot,
      servers: snapshot.servers.map((server) => ({
        ...server,
        probeKey: probeKeyForEntry('unknown', server.name),
        probeAvailable: canProbe && server.enabled,
        ...(canProbe && server.enabled ? {} : { probeUnavailableReason: canProbe ? ('disabled' as const) : ('probe_unavailable' as const) }),
      })),
      probe: {
        available: canProbe,
        manualOnly: true,
        maxConcurrent: this.probeService.maxConcurrent,
        timeoutMs: this.probeService.timeoutMs,
        profile: false,
        presets: false,
        ...(canProbe ? {} : { reason: 'runtime_unavailable' as const }),
      },
    }
  }
}

/** inventory 条目与配置候选的同一性键（作用域 + preset + 展示名）。 */
function candidateIdentity(scope: string, presetId: string | undefined, name: string): string {
  return `${scope}\u0000${presetId ?? ''}\u0000${name}`
}

function managerStage(stage: string): McpProbeStage {
  const value = stage.toLowerCase()
  if (value.includes('timeout')) return 'timeout'
  if (value.includes('cancel')) return 'cancelled'
  if (value.includes('tool') || value.includes('list')) return 'tools_list'
  if (value.includes('disabled')) return 'disabled'
  if (value.includes('unavailable') || value.includes('probe')) return 'unavailable'
  return 'connect'
}

function stageMessage(code: McpProbeStage): string {
  switch (code) {
    case 'timeout':
      return '探测超时'
    case 'cancelled':
      return '探测已取消'
    case 'tools_list':
      return '已连接，但读取工具列表失败'
    case 'disabled':
      return '该条目标记为未启用，不能探测'
    case 'unavailable':
      return '当前 Host 无法探测该条目'
    case 'connect':
    default:
      return '连接 MCP 服务器失败'
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
function unavailableSnapshot(warnings: WarningLog, probe: McpProbeAvailability): McpSnapshot {
  return {
    mode: 'unavailable',
    capabilities: DEGRADED_CAPABILITIES,
    probe,
    servers: [],
    warnings: warnings.warnings,
    warningItems: warnings.warningItems,
  }
}
