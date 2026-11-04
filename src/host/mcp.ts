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
 *
 * 两个来源都以可选晚绑定服务注入（`attachServices`）；都不存在或读取
 * 失败时快照降级为 `unavailable` + warning，绝不整体失败。
 *
 * 安全红线：快照只含聚合语义字段；条目携带的任何 env/headers/command/
 * URL/token 一律不进入 DTO（结构面类型上就未声明这些字段）。
 *
 * @module @hanxu131/toolscontrol-dsh/host/mcp
 */

import type { McpCapabilities, McpProbeResponse, McpSnapshot, McpServerEntry } from '../shared/protocol.ts'
import { errorMessage } from './services.ts'
import type { McpManagerFace, McpProbeOutcomeFace, McpManagedServerViewFace, PluginInventoryFace } from './services.ts'

/** Loader 条目视作 MCP 配置项的模块名（官方包名与插件短名）。 */
const MCP_CLIENT_MODULES = new Set(['@deepseek-ai/dsh-mcp-client', 'mcp-client'])

/** 是否为 MCP 客户端配置条目（精确匹配，避免前缀/后缀误判）。 */
export function isMcpClientModule(moduleName: string): boolean {
  return MCP_CLIENT_MODULES.has(moduleName)
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
    return unavailableSnapshot(['pluginInventory 服务不可用：MCP 配置条目无法读取'])
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

  /** rc.5 降级：配置条目 + 可靠启用状态；连接状态恒 unknown。 */
  private async configSnapshot(inventory: PluginInventoryFace, extraWarnings: string[] = []): Promise<McpSnapshot> {
    let entries
    try {
      entries = (await inventory.list()).entries
    } catch (error) {
      if (extraWarnings.length > 0) {
        return unavailableSnapshot([...extraWarnings, `pluginInventory 读取失败：${errorMessage(error)}`])
      }
      return unavailableSnapshot([`pluginInventory 读取失败：${errorMessage(error)}`])
    }
    const servers: McpServerEntry[] = entries
      .filter((entry) => isMcpClientModule(entry.moduleName))
      .map((entry) => ({
        name: entry.entryId,
        enabled: entry.enabled !== false,
        configured: true,
        status: 'unknown',
        source: 'unknown',
      }))
    return { mode: 'config', capabilities: DEGRADED_CAPABILITIES, servers, warnings: extraWarnings }
  }

  /** 官方 mcpManager 存在：透传真实状态（status.state 字符串）；畸形防御。 */
  private async managedSnapshot(manager: McpManagerFace): Promise<McpSnapshot> {
    let views: readonly McpManagedServerViewFace[]
    try {
      views = await manager.list()
    } catch (error) {
      const warning = `mcpManager 读取失败：${errorMessage(error)}`
      if (this.inventory !== undefined) return await this.configSnapshot(this.inventory, [warning])
      return unavailableSnapshot([warning])
    }
    const capabilities: McpCapabilities = {
      connectionStatus: true,
      toolCount: true,
      probe: typeof manager.probe === 'function',
    }
    const warnings: string[] = []
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
        }
      }
      warnings.push(`MCP 条目 ${view.name} 返回了无法解析的状态，已按 unknown 处理`)
      return { name: view.name, enabled: true, configured: view.configured !== false, status: 'unknown', source: 'unknown' }
    })
    return { mode: 'managed', capabilities, servers, warnings }
  }
}

/** 双来源都不可用或读取失败的统一降级快照。 */
function unavailableSnapshot(warnings: string[]): McpSnapshot {
  return { mode: 'unavailable', capabilities: DEGRADED_CAPABILITIES, servers: [], warnings }
}
