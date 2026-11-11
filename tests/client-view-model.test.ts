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
  countProbeTargets,
  filterMcpServers,
  filterSkillRows,
  groupSkills,
  isProbeRequestable,
  isProbeTarget,
  mcpEmptyStateKey,
  mcpStatusOptions,
  probeCapabilityAvailable,
  skillSourceOptions,
  skillsScopeLine,
} from '../src/client/view-model.ts'
import { en, zh } from '../src/client/i18n.ts'
import type { McpServerEntry, McpSnapshot, SkillEntry } from '../src/shared/protocol.ts'

/** rc.5 降级形态：连接状态恒 unknown、无工具数量。 */
function entry(overrides: Partial<McpServerEntry> & { name: string }): McpServerEntry {
  return {
    enabled: true,
    configured: true,
    status: 'unknown',
    source: 'unknown',
    scope: 'profile',
    probeKey: `profile:${overrides.name}`,
    probeAvailable: true,
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

describe('MCP 显式探测门控（probeKey）', () => {
  const CAPABILITIES = { connectionStatus: false, toolCount: false, probe: false }
  function mcp(probe: McpSnapshot['probe']): McpSnapshot {
    return { mode: 'config', capabilities: CAPABILITIES, ...(probe !== undefined ? { probe } : {}), servers: [], warnings: [] }
  }
  const AVAILABLE = mcp({ available: true, manualOnly: true, maxConcurrent: 2, timeoutMs: 10_000, profile: true, presets: true })
  const UNAVAILABLE = mcp({ available: false, manualOnly: true, maxConcurrent: 2, timeoutMs: 10_000, profile: false, presets: false, reason: 'config_source_unavailable' })

  it('mcp.probe 缺失或 available=false → 能力关闭；capabilities.probe 不参与门控', () => {
    expect(probeCapabilityAvailable(undefined)).toBe(false)
    expect(probeCapabilityAvailable(mcp(undefined))).toBe(false)
    expect(probeCapabilityAvailable(UNAVAILABLE)).toBe(false)
    expect(probeCapabilityAvailable(AVAILABLE)).toBe(true)
    // rc.5 的 capabilities.probe 恒 false，但独立探测可用。
    expect(AVAILABLE.capabilities.probe).toBe(false)
    expect(isProbeTarget(entry({ name: 'siyuan' }), AVAILABLE)).toBe(true)
  })

  it('enabled / probeAvailable / conditional 任一不满足都不可探测', () => {
    expect(isProbeTarget(entry({ name: 'a', enabled: false }), AVAILABLE)).toBe(false)
    expect(isProbeTarget(entry({ name: 'a', probeAvailable: false }), AVAILABLE)).toBe(false)
    expect(isProbeTarget(entry({ name: 'a', conditional: true }), AVAILABLE)).toBe(false)
    expect(isProbeTarget(entry({ name: 'a' }), UNAVAILABLE)).toBe(false)
  })

  it('loading 中的条目被视为不可再次发起；计数跳过 loading', () => {
    const rows = [
      entry({ name: 'a', probeKey: 'profile:a' }),
      entry({ name: 'b', probeKey: 'profile:b' }),
      entry({ name: 'c', probeKey: 'profile:c', probeAvailable: false }),
      entry({ name: 'd', probeKey: 'profile:d', enabled: false }),
      entry({ name: 'e', probeKey: 'profile:e', conditional: true }),
    ]
    const probes = { 'profile:a': { phase: 'loading' }, 'profile:b': { phase: 'ok' } }
    expect(isProbeRequestable(rows[0]!, AVAILABLE, probes)).toBe(false)
    expect(isProbeRequestable(rows[1]!, AVAILABLE, probes)).toBe(true)
    expect(countProbeTargets(rows, AVAILABLE, probes)).toBe(1)
    expect(countProbeTargets(rows, AVAILABLE, {})).toBe(2)
    expect(countProbeTargets(rows, UNAVAILABLE, {})).toBe(0)
    // 只统计传入的当前行（即筛选后的结果），不是整个快照。
    expect(countProbeTargets([rows[1]!], AVAILABLE, {})).toBe(1)
  })

  it('同名但不同 probeKey 的条目互不复用 loading/结果身份', () => {
    const profileRow = entry({ name: 'same', probeKey: 'profile:same', scope: 'profile' })
    const presetRow = entry({
      name: 'same',
      probeKey: 'preset:p1:same',
      scope: 'preset',
      preset: { id: 'p1' },
    })
    const probes = { 'profile:same': { phase: 'loading' } }
    expect(isProbeRequestable(profileRow, AVAILABLE, probes)).toBe(false)
    expect(isProbeRequestable(presetRow, AVAILABLE, probes)).toBe(true)
    expect(countProbeTargets([profileRow, presetRow], AVAILABLE, probes)).toBe(1)
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

describe('MCP 空态文案（不得让"没有条目"暗示"DSH 没有 MCP server"）', () => {
  const CAPS = { connectionStatus: false, toolCount: false, probe: false }
  function snapshot(overrides: Partial<McpSnapshot> = {}): McpSnapshot {
    return { mode: 'config', capabilities: CAPS, servers: [], warnings: [], ...overrides }
  }

  it('完整读取的 config 空清单 → 专用诚实空态（说明统计范围是 DSH profile/presets）', () => {
    expect(mcpEmptyStateKey(snapshot({ canAssertEmpty: true }))).toBe('mcp.emptyAll')
    // 判断依据是显式能力标志，不是 warning 文案：有 warning 但读取完整仍可断言。
    expect(mcpEmptyStateKey(snapshot({ canAssertEmpty: true, warnings: ['duplicate rows ignored'] }))).toBe(
      'mcp.emptyAll',
    )
  })

  it('config 但读取不完整（canAssertEmpty 缺失或 false）→ 通用空态：不能断言"未配置"', () => {
    expect(mcpEmptyStateKey(snapshot())).toBe('state.emptyAll')
    expect(mcpEmptyStateKey(snapshot({ canAssertEmpty: false, warnings: ['entries unavailable'] }))).toBe(
      'state.emptyAll',
    )
  })

  it('managed 零条目 → 通用空态：托管来源同样不得断言"未配置"', () => {
    expect(mcpEmptyStateKey(snapshot({ mode: 'managed' }))).toBe('state.emptyAll')
    expect(mcpEmptyStateKey(snapshot({ mode: 'managed', canAssertEmpty: true }))).toBe('state.emptyAll')
  })

  it('unavailable 模式 → 通用空态：服务不可用时不能断言"未配置"', () => {
    expect(mcpEmptyStateKey(snapshot({ mode: 'unavailable' }))).toBe('state.emptyAll')
    expect(mcpEmptyStateKey(undefined)).toBe('state.emptyAll')
  })

  it('中英文空态文案明确声明只统计 DSH 内部来源、未读取外部 CLI 配置', () => {
    for (const text of [zh['mcp.emptyAll'], en['mcp.emptyAll']]) {
      expect(text).toContain('DSH')
      expect(text.toLowerCase()).toContain('preset')
    }
    expect(zh['mcp.emptyAll']).toMatch(/未读取外部 CLI 配置/)
    expect(en['mcp.emptyAll']).toMatch(/external CLI config/)
  })
})

describe('Skills 顶部范围文案（会话 scope / 目录未知）', () => {
  it('有工作区标题时显示工作区', () => {
    expect(skillsScopeLine({ sessionId: 's1', cwd: '/proj', workspaceTitle: 'Demo' })).toEqual({
      key: 'workspace.title',
      title: 'Demo',
    })
  })

  it('有 cwd 但无标题时以 cwd 作为工作区标题', () => {
    expect(skillsScopeLine({ sessionId: 's1', cwd: '/proj', workspaceTitle: null })).toEqual({
      key: 'workspace.title',
      title: '/proj',
    })
  })

  it('有主会话但无 cwd → 会话 preset 范围文案，不显示"全局 Skills"', () => {
    expect(skillsScopeLine({ sessionId: 's1', cwd: null, workspaceTitle: null })).toEqual({
      key: 'workspace.sessionNoCwd',
      sessionId: 's1',
    })
  })

  it('无会话且无目录 → 全局/未选中工作区文案', () => {
    expect(skillsScopeLine({ sessionId: null, cwd: null, workspaceTitle: null })).toEqual({ key: 'workspace.none' })
  })

  it('中英文会话范围文案说明 preset scope 与目录未知，且不冒充全局 Skills', () => {
    expect(zh['workspace.sessionNoCwd']).toContain('{sessionId}')
    expect(zh['workspace.sessionNoCwd']).toMatch(/preset/)
    expect(zh['workspace.sessionNoCwd']).toMatch(/目录未知/)
    expect(zh['workspace.sessionNoCwd']).not.toMatch(/全局/)
    expect(en['workspace.sessionNoCwd']).toContain('{sessionId}')
    expect(en['workspace.sessionNoCwd']).toMatch(/preset scope/)
    expect(en['workspace.sessionNoCwd']).toMatch(/directory is unknown/)
    expect(en['workspace.sessionNoCwd']).not.toMatch(/global/i)
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
