/**
 * 只读总览聚合门面（CONTEXT.md「总览」）：一次给出 MCP 与 Skills 两个
 * 纵切的快照。任一纵切失败只降级该纵切（空快照 + warning），绝不拖垮
 * 整个快照；显式工具探测委托给 MCP 目录（仅显式调用）。
 *
 * @module @hanxu131/toolscontrol-dsh/host/inventory
 */

import { PLUGIN_NAME, PLUGIN_VERSION, type McpProbeResponse, type McpSnapshot, type OverviewSnapshot, type SkillsSnapshot } from '../shared/protocol.ts'
import { errorMessage } from './services.ts'
import type { McpCatalog } from './mcp.ts'
import type { SkillCatalog } from './skills.ts'

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
   * 失败时另一侧照常返回。
   */
  async snapshot(cwd?: string): Promise<OverviewSnapshot> {
    const [mcpOutcome, skillsOutcome] = await Promise.allSettled([this.mcp.snapshot(), this.skills.snapshot(cwd)])
    return {
      plugin: PLUGIN_NAME,
      version: PLUGIN_VERSION,
      generatedAt: Date.now(),
      mcp: mcpOutcome.status === 'fulfilled' ? mcpOutcome.value : degradedMcpSnapshot(mcpOutcome.reason),
      skills: skillsOutcome.status === 'fulfilled' ? skillsOutcome.value : degradedSkillsSnapshot(cwd, skillsOutcome.reason),
    }
  }

  /** 显式 MCP 工具探测（转发；路由层只在此入口显式触发）。 */
  probe(server: string): Promise<McpProbeResponse> {
    return this.mcp.probe(server)
  }
}

/** MCP 纵切聚合失败的统一降级快照。 */
function degradedMcpSnapshot(reason: unknown): McpSnapshot {
  return {
    mode: 'unavailable',
    capabilities: { connectionStatus: false, toolCount: false, probe: false },
    servers: [],
    warnings: [`MCP 聚合失败：${errorMessage(reason)}`],
  }
}

/** Skills 纵切聚合失败的统一降级快照。 */
function degradedSkillsSnapshot(cwd: string | undefined, reason: unknown): SkillsSnapshot {
  return {
    cwd: cwd ?? null,
    skills: [],
    warnings: [`Skills 聚合失败：${errorMessage(reason)}`],
  }
}
