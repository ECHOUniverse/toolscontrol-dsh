/**
 * Client 视图模型测试：MCP 筛选（slice 1）。
 *
 * 测试接缝：公开纯函数（filterMcpServers / statusOptions）。
 * 不测私有方法，不做 React 组件交互测试。
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MCP_FILTERS,
  DEFAULT_SKILLS_FILTERS,
  collatorFor,
  filterMcpServers,
  filterSkillRows,
  groupSkills,
  mcpStatusOptions,
  skillSourceOptions,
} from '../src/client/view-model.ts'
import type { McpServerEntry, SkillEntry } from '../src/shared/protocol.ts'

/** rc.5 降级形态：连接状态恒 unknown、无工具数量。 */
function entry(overrides: Partial<McpServerEntry> & { name: string }): McpServerEntry {
  return {
    enabled: true,
    configured: true,
    status: 'unknown',
    source: 'unknown',
    ...overrides,
  }
}

function skill(overrides: Partial<SkillEntry> & { name: string }): SkillEntry {
  return {
    description: 'desc',
    source: 'project-dsh',
    visibility: 'effective',
    invocation: { modelInvocable: true, userInvocable: true },
    ...overrides,
  }
}

const COLLATOR = collatorFor('en')

describe('MCP 筛选（slice 1）', () => {
  const servers = [
    entry({ name: 'siyuan', enabled: true }),
    entry({ name: 'notion', enabled: true }),
    entry({ name: 'zotero', enabled: false }),
  ]

  it('默认筛选只显示 enabled=true 的条目', () => {
    const rows = filterMcpServers(servers, DEFAULT_MCP_FILTERS, COLLATOR)
    expect(rows.map((row) => row.name)).toEqual(['notion', 'siyuan'])
  })

  it('enabled=disabled 只显示已禁用条目', () => {
    const rows = filterMcpServers(servers, { ...DEFAULT_MCP_FILTERS, enabled: 'disabled' }, COLLATOR)
    expect(rows.map((row) => row.name)).toEqual(['zotero'])
  })

  it('enabled=all 显示全部条目', () => {
    const rows = filterMcpServers(servers, { ...DEFAULT_MCP_FILTERS, enabled: 'all' }, COLLATOR)
    expect(rows).toHaveLength(3)
  })

  it('名称搜索不区分大小写，与启用筛选可组合', () => {
    const rows = filterMcpServers(servers, { ...DEFAULT_MCP_FILTERS, enabled: 'all', query: 'NOTION' }, COLLATOR)
    expect(rows.map((row) => row.name)).toEqual(['notion'])
  })

  it('连接状态筛选可组合（rc.5 全部 unknown）', () => {
    const rows = filterMcpServers(
      servers,
      { ...DEFAULT_MCP_FILTERS, enabled: 'all', status: 'unknown' },
      COLLATOR,
    )
    expect(rows).toHaveLength(3)
    const none = filterMcpServers(
      servers,
      { ...DEFAULT_MCP_FILTERS, enabled: 'all', status: 'connected' },
      COLLATOR,
    )
    expect(none).toEqual([])
  })

  it('状态选项来自快照中的去重状态集合', () => {
    const mixed = [
      entry({ name: 'a', status: 'unknown' }),
      entry({ name: 'b', status: 'connected', enabled: false }),
      entry({ name: 'c', status: 'unknown', enabled: false }),
    ]
    expect(mcpStatusOptions(mixed, COLLATOR)).toEqual(['connected', 'unknown'])
  })

  it('空快照不产生状态选项', () => {
    expect(mcpStatusOptions([], COLLATOR)).toEqual([])
  })
})

describe('Skills 分组（slice 2）', () => {
  it('主列表只出现 effective 项，同名 shadowed 归入该项详情', () => {
    const skills = [
      skill({ name: 'review', source: 'project-dsh', visibility: 'effective' }),
      skill({ name: 'review', source: 'user-agents', visibility: 'shadowed', shadowedBy: 'project-dsh' }),
      skill({ name: 'deploy', source: 'user-dsh', visibility: 'effective' }),
    ]
    const rows = groupSkills(skills)
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.effective?.name)).toEqual(['review', 'deploy'])
    expect(rows[0]!.shadowed).toHaveLength(1)
    expect(rows[0]!.shadowed[0]!.source).toBe('user-agents')
    expect(rows[1]!.shadowed).toHaveLength(0)
  })

  it('被遮蔽项不会成为独立主行（同名无 effective 时保留为仅遮蔽组）', () => {
    const skills = [skill({ name: 'ghost', source: 'runtime', visibility: 'shadowed', shadowedBy: 'x' })]
    const rows = groupSkills(skills)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.effective).toBeNull()
    expect(rows[0]!.shadowed).toHaveLength(1)
  })

  it('主行筛选/搜索只作用于生效项，shadowed 不作为独立命中', () => {
    const skills = [
      skill({ name: 'review', description: 'code review', source: 'project-dsh', visibility: 'effective' }),
      skill({ name: 'review', description: 'totally different text unique-marker', source: 'user-agents', visibility: 'shadowed', shadowedBy: 'project-dsh' }),
    ]
    const rows = groupSkills(skills)
    // 搜索词只命中 shadowed 的描述 → 不产生独立主行，也不该让主行凭空出现
    const miss = filterSkillRows(rows, { ...DEFAULT_SKILLS_FILTERS, query: 'unique-marker' }, COLLATOR)
    expect(miss).toEqual([])
    // 命中主行时，行内仍携带 shadowed 详情
    const hit = filterSkillRows(rows, { ...DEFAULT_SKILLS_FILTERS, query: 'review' }, COLLATOR)
    expect(hit).toHaveLength(1)
    expect(hit[0]!.shadowed).toHaveLength(1)
  })

  it('来源筛选按生效项来源匹配', () => {
    const rows = groupSkills([
      skill({ name: 'a', source: 'project-dsh' }),
      skill({ name: 'b', source: 'user-dsh' }),
    ])
    const onlyProject = filterSkillRows(rows, { ...DEFAULT_SKILLS_FILTERS, source: 'project-dsh' }, COLLATOR)
    expect(onlyProject.map((row) => row.effective?.name)).toEqual(['a'])
  })

  it('userInvocable 筛选', () => {
    const rows = groupSkills([
      skill({ name: 'both', invocation: { modelInvocable: true, userInvocable: true } }),
      skill({ name: 'model-only', invocation: { modelInvocable: true, userInvocable: false } }),
    ])
    const userOnly = filterSkillRows(rows, { ...DEFAULT_SKILLS_FILTERS, invocation: 'user' }, COLLATOR)
    expect(userOnly.map((row) => row.effective?.name)).toEqual(['both'])
    const modelOnly = filterSkillRows(rows, { ...DEFAULT_SKILLS_FILTERS, invocation: 'model' }, COLLATOR)
    expect(modelOnly).toHaveLength(2)
  })

  it('来源选项来自生效项去重集合（含仅遮蔽组的来源兜底）', () => {
    const rows = groupSkills([
      skill({ name: 'a', source: 'project-dsh' }),
      skill({ name: 'b', source: 'project-dsh' }),
      skill({ name: 'c', source: 'bundled' }),
      skill({ name: 'ghost', source: 'runtime', visibility: 'shadowed' }),
    ])
    expect(skillSourceOptions(rows, COLLATOR)).toEqual(['bundled', 'project-dsh', 'runtime'])
  })
})

describe('稳定排序按当前语言（slice 3）', () => {
  it('MCP 行按当前语言的 Collator 排序（zh 按拼音：安 < 中）', () => {
    const servers = [entry({ name: '中文' }), entry({ name: '安全' })]
    const zh = filterMcpServers(servers, DEFAULT_MCP_FILTERS, collatorFor('zh'))
    expect(zh.map((row) => row.name)).toEqual(['安全', '中文'])
    const en = filterMcpServers(servers, DEFAULT_MCP_FILTERS, collatorFor('en'))
    expect(en.map((row) => row.name)).toEqual(['中文', '安全'])
  })

  it('同名条目保持输入顺序（稳定排序）', () => {
    const servers = [
      entry({ name: 'same', enabled: true }),
      entry({ name: 'same', enabled: false }),
      entry({ name: 'same', enabled: true }),
    ]
    const rows = filterMcpServers(servers, { ...DEFAULT_MCP_FILTERS, enabled: 'all' }, COLLATOR)
    expect(rows.map((row) => row.enabled)).toEqual([true, false, true])
  })

  it('Skills 主行同样按当前语言 Collator 排序', () => {
    const rows = groupSkills([
      skill({ name: '中文技能' }),
      skill({ name: 'alpha' }),
    ])
    const en = filterSkillRows(rows, DEFAULT_SKILLS_FILTERS, collatorFor('en'))
    expect(en.map((row) => row.effective?.name)).toEqual(['alpha', '中文技能'])
    const zh = filterSkillRows(rows, DEFAULT_SKILLS_FILTERS, collatorFor('zh'))
    expect(zh.map((row) => row.effective?.name)).toEqual(['中文技能', 'alpha'])
  })

  it('非法语言标签防御为 en Collator', () => {
    expect(() => collatorFor('../etc/passwd')).not.toThrow()
    const rows = filterMcpServers([entry({ name: 'b' }), entry({ name: 'a' })], DEFAULT_MCP_FILTERS, collatorFor('??'))
    expect(rows.map((row) => row.name)).toEqual(['a', 'b'])
  })
})
