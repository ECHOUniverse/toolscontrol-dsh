/**
 * 只读总览聚合门面（CONTEXT.md「总览」）：一次给出 MCP 与 Skills 两个
 * 纵切的快照。任一纵切失败只降级该纵切（空快照 + warning），绝不拖垮
 * 整个快照；显式工具探测委托给 MCP 目录（仅显式调用）。
 *
 * @module @hanxu131/toolscontrol-dsh/host/inventory
 */

import { PLUGIN_NAME, PLUGIN_VERSION, type McpProbeResponse, type McpSnapshot, type OverviewSnapshot, type SkillsSnapshot } from '../shared/protocol.ts'
import { errorMessage } from './services.ts'
import { PROBE_MAX_CONCURRENT, PROBE_TIMEOUT_MS } from './mcp-probe.ts'
import type { McpCatalog } from './mcp.ts'
import type { SkillCatalog } from './skills.ts'
import { warn, warningLog } from './warnings.ts'

/** 只读总览服务。 */
export class OverviewService {
  private readonly mcp: McpCatalog
  private readonly skills: SkillCatalog

  constructor(mcp: McpCatalog, skills: SkillCatalog) {
    this.mcp = mcp
    this.skills = skills
  }

  /**
   * 当前总览快照。两个纵切并发聚合；`Promise.allSettled` 保证单侧
   * 失败时另一侧照常返回。`sessionId` 让 Skills 按该会话的 preset
   * scope 读取官方注册表（不能只用 cwd：当前 DSH 的 skill-filesystem
   * 注册在会话 preset 层）。
   */
  async snapshot(cwd?: string, sessionId?: string): Promise<OverviewSnapshot> {
    const [mcpOutcome, skillsOutcome] = await Promise.allSettled([this.mcp.snapshot(), this.skills.snapshot(cwd, sessionId)])
    return {
      plugin: PLUGIN_NAME,
      version: PLUGIN_VERSION,
      generatedAt: Date.now(),
      mcp: mcpOutcome.status === 'fulfilled' ? mcpOutcome.value : degradedMcpSnapshot(mcpOutcome.reason),
      skills: skillsOutcome.status === 'fulfilled' ? skillsOutcome.value : degradedSkillsSnapshot(cwd, skillsOutcome.reason),
    }
  }

  /** 旧版按名称显式探测（托管路径兼容；只在此入口显式触发）。 */
  probe(server: string, options: { signal?: AbortSignal } = {}): Promise<McpProbeResponse> {
    return this.mcp.probe(server, options)
  }

  /** 新版稳定 probeKey 单条探测（页面/请求中断可传 AbortSignal）。 */
  probeByKey(probeKey: string, options: { signal?: AbortSignal } = {}): Promise<McpProbeResponse> {
    return this.mcp.probeByKey(probeKey, options)
  }

  /** 插件 dispose：中止所有在途探测并等待连接关闭。 */
  disposeProbes(): Promise<void> {
    return this.mcp.disposeProbes()
  }
}

/** MCP 纵切聚合失败的统一降级快照。 */
function degradedMcpSnapshot(reason: unknown): McpSnapshot {
  const warnings = warningLog()
  warn(warnings, 'mcp.aggregateFailed', { message: errorMessage(reason) }, `MCP 聚合失败：${errorMessage(reason)}`)
  return {
    mode: 'unavailable',
    capabilities: { connectionStatus: false, toolCount: false, probe: false },
    probe: {
      available: false,
      manualOnly: true,
      maxConcurrent: PROBE_MAX_CONCURRENT,
      timeoutMs: PROBE_TIMEOUT_MS,
      profile: false,
      presets: false,
      reason: 'config_source_unavailable',
    },
    servers: [],
    warnings: warnings.warnings,
    warningItems: warnings.warningItems,
  }
}

/** Skills 纵切聚合失败的统一降级快照。 */
function degradedSkillsSnapshot(cwd: string | undefined, reason: unknown): SkillsSnapshot {
  const warnings = warningLog()
  warn(warnings, 'skills.aggregateFailed', { message: errorMessage(reason) }, `Skills 聚合失败：${errorMessage(reason)}`)
  return {
    cwd: cwd ?? null,
    skills: [],
    warnings: warnings.warnings,
    warningItems: warnings.warningItems,
  }
}
