/**
 * 聚合门面（OverviewService）— MCP 与 Skills 快照的一次性组装。
 *
 * 产品语义：只读总览一次给出 MCP 与 Skills 两块；任一纵切失败只降级
 * 该纵切（空快照 + warning），绝不拖垮整个快照（CONTEXT.md「只读总览」）。
 */
import { describe, expect, it } from 'vitest'
import { McpCatalog } from '../src/host/mcp.ts'
import { OverviewService } from '../src/host/inventory.ts'
import { SkillCatalog } from '../src/host/skills.ts'
import type { PluginInventoryEntryFace, SkillSummaryFace } from '../src/host/services.ts'

const INVENTORY_ENTRY: PluginInventoryEntryFace = {
  entryId: 'mcp.notes',
  moduleName: '@deepseek-ai/dsh-mcp-client',
  enabled: true,
}

const SKILL: SkillSummaryFace = {
  name: 'demo',
  description: 'Demo skill',
  invocation: { modelInvocable: true, userInvocable: true },
  source: 'user-dsh',
  provider: 'filesystem',
}

describe('总览聚合快照', () => {
  it('组装 MCP 与 Skills 两个纵切并携带插件标识与生成时间', async () => {
    const overview = new OverviewService(
      new McpCatalog({ inventory: { list: async () => ({ entries: [INVENTORY_ENTRY] }) } }),
      new SkillCatalog({ registry: { list: async () => [SKILL] } }),
    )
    const snap = await overview.snapshot('/workspace/demo')
    expect(snap.plugin).toBe('@hanxu131/toolscontrol-dsh')
    expect(snap.version).toBe('0.1.0')
    expect(snap.generatedAt).toBeTypeOf('number')
    expect(snap.mcp.mode).toBe('config')
    expect(snap.mcp.servers).toHaveLength(1)
    expect(snap.skills.cwd).toBe('/workspace/demo')
    expect(snap.skills.skills.map((entry) => entry.name)).toEqual(['demo'])
  })

  it('MCP 纵切失败只降级该纵切：Skills 照常返回，快照整体不失败', async () => {
    const mcp = new McpCatalog({ inventory: { list: async () => { throw new Error('mcp side boom') } } })
    const overview = new OverviewService(mcp, new SkillCatalog({ registry: { list: async () => [SKILL] } }))
    const snap = await overview.snapshot()
    expect(snap.mcp.mode).toBe('unavailable')
    expect(snap.mcp.warnings.join('\n')).toMatch(/mcp side boom/)
    expect(snap.skills.skills.map((entry) => entry.name)).toEqual(['demo'])
  })

  it('Skills 纵切失败只降级该纵切：MCP 照常返回', async () => {
    const skills = new SkillCatalog({ registry: { list: async () => { throw new Error('skills side boom') } } })
    const overview = new OverviewService(
      new McpCatalog({ inventory: { list: async () => ({ entries: [INVENTORY_ENTRY] }) } }),
      skills,
    )
    const snap = await overview.snapshot()
    expect(snap.mcp.servers).toHaveLength(1)
    expect(snap.skills.skills).toEqual([])
    expect(snap.skills.warnings.join('\n')).toMatch(/skills side boom/)
  })

  it('probe 委托给 MCP 目录（显式探测入口）', async () => {
    const overview = new OverviewService(new McpCatalog({}), new SkillCatalog({}))
    const outcome = await overview.probe('anything')
    expect(outcome).toMatchObject({ ok: false, code: 'unavailable' })
  })
})
