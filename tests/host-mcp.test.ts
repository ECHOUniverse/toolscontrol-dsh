/**
 * MCP 只读聚合 — rc.5 配置层降级路径（pluginInventory）。
 *
 * 产品语义（CONTEXT.md）：
 * - 已启用项/已禁用项：配置层面状态，禁用项保留在列表中可筛选；
 * - 连接状态未知：rc.5 无法观测连接情况，一律标注 unknown，
 *   绝不以插件加载状态（fiberPhase 等）冒充连接状态；
 * - 来源可信度：pluginInventory 无作用域信息 → 条目来源标 unknown；
 * - 能力不可用：工具数量与工具探测在 rc.5 明确标注不可用；
 * - 敏感信息不透出：任何 env/headers/命令/URL/token 不得进入快照。
 */
import { describe, expect, it } from 'vitest'
import { McpCatalog } from '../src/host/mcp.ts'
import type {
  McpManagerFace,
  McpManagedServerViewFace,
  PluginInventoryEntryFace,
  PluginInventoryFace,
} from '../src/host/services.ts'

/** 构造 pluginInventory 结构面（rc.5 只承诺 entryId/moduleName/enabled）。 */
function inventoryOf(entries: PluginInventoryEntryFace[]): PluginInventoryFace {
  return { list: async () => ({ entries }) }
}

/** 构造官方 mcpManager 结构面（未来环境；行为由测试注入）。 */
function managerOf(
  views: McpManagedServerViewFace[],
  probe?: McpManagerFace['probe'],
): McpManagerFace {
  const face: McpManagerFace = { list: async () => views }
  if (probe !== undefined) face.probe = probe
  return face
}

const MCP_ENTRY: PluginInventoryEntryFace = {
  entryId: 'mcp.notes',
  moduleName: '@deepseek-ai/dsh-mcp-client',
  enabled: true,
}

describe('MCP 配置层聚合（rc.5 pluginInventory 降级）', () => {
  it('把 mcp-client 配置条目聚合成服务器条目，来源保守标未知', async () => {
    const catalog = new McpCatalog({ inventory: inventoryOf([MCP_ENTRY]) })
    const snap = await catalog.snapshot()
    expect(snap.mode).toBe('config')
    expect(snap.servers).toEqual([
      { name: 'mcp.notes', enabled: true, configured: true, status: 'unknown', source: 'unknown' },
    ])
  })

  it('已禁用条目保留在列表中（不过滤），enabled 如实标注', async () => {
    const catalog = new McpCatalog({
      inventory: inventoryOf([
        MCP_ENTRY,
        { entryId: 'mcp.off', moduleName: '@deepseek-ai/dsh-mcp-client', enabled: false },
      ]),
    })
    const snap = await catalog.snapshot()
    expect(snap.servers).toHaveLength(2)
    expect(snap.servers.map((server) => server.enabled)).toEqual([true, false])
  })

  it('连接状态恒为 unknown：即使条目携带加载状态也不冒充连接状态', async () => {
    const catalog = new McpCatalog({
      inventory: inventoryOf([
        // fiberPhase 是 pluginInventory 的真实字段，但绝不映射连接状态
        { ...MCP_ENTRY, fiberPhase: 'active' },
      ] as PluginInventoryEntryFace[]),
    })
    const snap = await catalog.snapshot()
    expect(snap.servers.every((server) => server.status === 'unknown')).toBe(true)
  })

  it('识别官方包名与插件短名两种 mcp-client 条目，排除无关模块', async () => {
    const catalog = new McpCatalog({
      inventory: inventoryOf([
        MCP_ENTRY,
        { entryId: 'short', moduleName: 'mcp-client', enabled: true },
        { entryId: 'other', moduleName: '@hanxu131/dsh-zotero', enabled: true },
        { entryId: 'tricky', moduleName: 'not-really-dsh-mcp-client', enabled: true },
      ]),
    })
    const snap = await catalog.snapshot()
    expect(snap.servers.map((server) => server.name)).toEqual(['mcp.notes', 'short'])
  })

  it('能力不可用：连接状态/工具数量/工具探测在 rc.5 全部标注 false', async () => {
    const catalog = new McpCatalog({ inventory: inventoryOf([MCP_ENTRY]) })
    const snap = await catalog.snapshot()
    expect(snap.capabilities).toEqual({ connectionStatus: false, toolCount: false, probe: false })
  })

  it('敏感信息不透出：条目携带的 env/headers/command/url 不得进入快照', async () => {
    const catalog = new McpCatalog({
      inventory: inventoryOf([
        {
          ...MCP_ENTRY,
          env: { API_TOKEN: 'super-secret-token-value' },
          headers: { Authorization: 'Bearer leaked-credential' },
          command: 'npx',
          url: 'http://127.0.0.1:9999/mcp',
        } as PluginInventoryEntryFace,
      ]),
    })
    const snap = await catalog.snapshot()
    const text = JSON.stringify(snap)
    expect(text).not.toContain('super-secret-token-value')
    expect(text).not.toContain('leaked-credential')
    expect(text).not.toContain('127.0.0.1:9999')
    // 字段白名单：服务器条目只允许聚合语义字段
    for (const server of snap.servers) {
      expect(Object.keys(server).sort()).toEqual(['configured', 'enabled', 'name', 'source', 'status'])
    }
  })

  it('pluginInventory 服务缺失时降级：空列表 + 明确 warning，不抛错', async () => {
    const catalog = new McpCatalog({})
    const snap = await catalog.snapshot()
    expect(snap.mode).toBe('unavailable')
    expect(snap.servers).toEqual([])
    expect(snap.warnings.join('\n')).toMatch(/pluginInventory/)
  })

  it('inventory 读取失败时单来源降级：空列表 + warning，快照不失败', async () => {
    const catalog = new McpCatalog({
      inventory: { list: async () => { throw new Error('loader unavailable') } },
    })
    const snap = await catalog.snapshot()
    expect(snap.mode).toBe('unavailable')
    expect(snap.servers).toEqual([])
    expect(snap.warnings.join('\n')).toMatch(/loader unavailable/)
  })
})

describe('MCP 托管聚合（官方 mcpManager 晚绑定，未来环境）', () => {
  // 官方 McpManagedServerView（master 源码核实）：{ name, configured,
  // status: 对象联合 }；状态字符串取 status.state，toolCount 只在
  // state==='connected' 的 status 内。夹具用独立字面量还原真实形状。
  const MANAGED_VIEWS: McpManagedServerViewFace[] = [
    { name: 'notes', configured: true, status: { state: 'connected', toolCount: 7, connectedAt: 1700000000000 } },
    { name: 'docs', configured: true, status: { state: 'disabled' } },
    { name: 'flaky', configured: true, status: { state: 'reconnecting', attempt: 2, maxAttempts: 5, nextRetryAtMs: 1700000001000, lastError: 'ECONNRESET' } },
    { name: 'waiting', configured: true, status: { state: 'waiting-credentials', lastError: 'missing credential' } },
    { name: 'gave-up', configured: true, status: { state: 'failed', reason: 'gave-up', lastError: 'budget exhausted' } },
    { name: 'removed', configured: false, status: { state: 'failed', reason: 'cleanup', lastError: 'cleanup pending' } },
  ]

  it('状态取 status.state 字符串：disabled 保留、toolCount 仅 connected 从 status 内读取', async () => {
    const catalog = new McpCatalog({ manager: managerOf(MANAGED_VIEWS) })
    const snap = await catalog.snapshot()
    expect(snap.mode).toBe('managed')
    expect(snap.servers).toEqual([
      { name: 'notes', enabled: true, configured: true, status: 'connected', toolCount: 7, source: 'unknown' },
      { name: 'docs', enabled: false, configured: true, status: 'disabled', source: 'unknown' },
      { name: 'flaky', enabled: true, configured: true, status: 'reconnecting', source: 'unknown' },
      { name: 'waiting', enabled: true, configured: true, status: 'waiting-credentials', source: 'unknown' },
      { name: 'gave-up', enabled: true, configured: true, status: 'failed', source: 'unknown' },
      { name: 'removed', enabled: true, configured: false, status: 'failed', source: 'unknown' },
    ])
  })

  it('来源保守标 unknown：即使托管模式（manager 只治理全局面）也不无依据标注', async () => {
    const catalog = new McpCatalog({ manager: managerOf(MANAGED_VIEWS) })
    const snap = await catalog.snapshot()
    expect(snap.servers.every((server) => server.source === 'unknown')).toBe(true)
  })

  it('manager 与 inventory 同时在时以 manager 为准（真实状态优先）', async () => {
    const catalog = new McpCatalog({
      manager: managerOf(MANAGED_VIEWS),
      inventory: inventoryOf([MCP_ENTRY]),
    })
    const snap = await catalog.snapshot()
    expect(snap.mode).toBe('managed')
    expect(snap.servers).toHaveLength(6)
  })

  it('托管模式能力如实标注：状态/工具数量可用，probe 取决于服务是否提供', async () => {
    const withProbe = new McpCatalog({ manager: managerOf(MANAGED_VIEWS, async () => ({ ok: true, toolNames: [] })) })
    expect((await withProbe.snapshot()).capabilities).toEqual({ connectionStatus: true, toolCount: true, probe: true })
    const withoutProbe = new McpCatalog({ manager: managerOf(MANAGED_VIEWS) })
    expect((await withoutProbe.snapshot()).capabilities).toEqual({ connectionStatus: true, toolCount: true, probe: false })
  })

  it('畸形状态防御为 unknown 并携带 warning：status 非对象/缺 state/state 非字符串都不抛垮快照', async () => {
    const catalog = new McpCatalog({
      manager: managerOf([
        { name: 'good', configured: true, status: { state: 'connected', toolCount: 1, connectedAt: 1 } },
        { name: 'nullish', configured: true, status: null },
        { name: 'stateless', configured: true, status: { toolCount: 3 } },
        { name: 'weird', configured: true, status: { state: 42 } },
      ] as unknown as McpManagedServerViewFace[]),
    })
    const snap = await catalog.snapshot()
    expect(snap.mode).toBe('managed')
    expect(snap.servers).toEqual([
      { name: 'good', enabled: true, configured: true, status: 'connected', toolCount: 1, source: 'unknown' },
      { name: 'nullish', enabled: true, configured: true, status: 'unknown', source: 'unknown' },
      { name: 'stateless', enabled: true, configured: true, status: 'unknown', source: 'unknown' },
      { name: 'weird', enabled: true, configured: true, status: 'unknown', source: 'unknown' },
    ])
    for (const broken of ['nullish', 'stateless', 'weird']) {
      expect(snap.warnings.some((warning) => warning.includes(broken))).toBe(true)
    }
  })

  it('manager 读取失败时降级到配置层并携带 warning，快照不失败', async () => {
    const catalog = new McpCatalog({
      manager: { list: async () => { throw new Error('manager crashed') } },
      inventory: inventoryOf([MCP_ENTRY]),
    })
    const snap = await catalog.snapshot()
    expect(snap.mode).toBe('config')
    expect(snap.servers).toHaveLength(1)
    expect(snap.warnings.join('\n')).toMatch(/manager crashed/)
  })

  it('晚绑定 cycle：detach manager 后回到配置降级路径', async () => {
    const catalog = new McpCatalog({ inventory: inventoryOf([MCP_ENTRY]) })
    catalog.attachServices({ manager: managerOf(MANAGED_VIEWS) })
    expect((await catalog.snapshot()).mode).toBe('managed')
    catalog.detachServices(['manager'])
    expect((await catalog.snapshot()).mode).toBe('config')
  })
})

describe('MCP 显式工具探测（仅显式调用；绝不自动触发）', () => {
  it('probe 成功：透传工具名', async () => {
    const catalog = new McpCatalog({
      manager: managerOf([], async () => ({ ok: true, toolNames: ['search', 'fetch'] })),
    })
    expect(await catalog.probe('notes')).toEqual({ ok: true, toolNames: ['search', 'fetch'] })
  })

  it('probe 失败：透传阶段与原因', async () => {
    const catalog = new McpCatalog({
      manager: managerOf([], async () => ({ ok: false, stage: 'connect', message: 'connection refused' })),
    })
    expect(await catalog.probe('flaky')).toEqual({
      ok: false,
      code: 'probe_failed',
      message: 'connection refused',
      stage: 'connect',
    })
  })

  it('probe 抛错：归一为 probe_failed 且不外泄堆栈以外的内容', async () => {
    const catalog = new McpCatalog({
      manager: managerOf([], async () => { throw new Error('probe exploded') }),
    })
    const outcome = await catalog.probe('notes')
    expect(outcome.ok).toBe(false)
    expect(outcome.code).toBe('probe_failed')
    expect(outcome.message).toMatch(/probe exploded/)
  })

  it('无 manager 或 manager 未提供 probe：probe_unavailable（rc.5 能力不可用）', async () => {
    const noManager = new McpCatalog({ inventory: inventoryOf([MCP_ENTRY]) })
    expect(await noManager.probe('mcp.notes')).toMatchObject({ ok: false, code: 'probe_unavailable' })
    const noProbeMethod = new McpCatalog({ manager: managerOf([]) })
    expect(await noProbeMethod.probe('notes')).toMatchObject({ ok: false, code: 'probe_unavailable' })
  })
})

describe('toolCount 有限性', () => {
  it('connected 的 toolCount 必须有限：NaN/Infinity 不进入 DTO', async () => {
    const catalog = new McpCatalog({
      manager: managerOf([
        { name: 'nan', configured: true, status: { state: 'connected', toolCount: Number.NaN, connectedAt: 1 } },
        { name: 'inf', configured: true, status: { state: 'connected', toolCount: Number.POSITIVE_INFINITY, connectedAt: 1 } },
        { name: 'ok', configured: true, status: { state: 'connected', toolCount: 3, connectedAt: 1 } },
      ]),
    })
    const snap = await catalog.snapshot()
    expect(snap.servers).toEqual([
      { name: 'nan', enabled: true, configured: true, status: 'connected', source: 'unknown' },
      { name: 'inf', enabled: true, configured: true, status: 'connected', source: 'unknown' },
      { name: 'ok', enabled: true, configured: true, status: 'connected', toolCount: 3, source: 'unknown' },
    ])
  })
})
