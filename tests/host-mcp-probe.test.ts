/**
 * 独立 MCP 探测（Host 侧）：
 * - 配置读取 / probeKey 稳定性（profile + preset、重复/空 id、敏感字段）；
 * - 手动单条、并发 2、同键去重、10s 超时/取消、成功/0 工具/失败/清理；
 * - 原始错误绝不进入响应；stdio 子环境复刻 DSH 的凭据剔除规则。
 *
 * 所有连接均由测试注入的 connector 模拟：不启动真实 MCP、不访问网络。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { McpCatalog } from '../src/host/mcp.ts'
import { McpProbeConfigReader, evaluateEnvExpression, probeKeyForEntry } from '../src/host/mcp-config.ts'
import { buildScrubbedChildEnv, McpProbeService, PROBE_MAX_CONCURRENT, PROBE_TIMEOUT_MS, type ProbeSession } from '../src/host/mcp-probe.ts'
import type {
  AgentPresetsFace,
  LoaderEntryFace,
  LoaderFace,
  PluginInventoryEntryFace,
  PluginInventoryFace,
  PluginInventoryPresetFace,
} from '../src/host/services.ts'
import type { McpProbeResponse, McpServerEntry } from '../src/shared/protocol.ts'
import type { ProbeCandidate, ProbeConfigReaderFace } from '../src/host/mcp-config.ts'

const MCP_MODULE = '@deepseek-ai/dsh-mcp-client'

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

function loaderOf(entries: LoaderEntryFace[]): LoaderFace {
  return { entries: () => entries }
}

function inventoryOf(snapshot: { entries?: readonly unknown[]; agentPresets?: unknown }): PluginInventoryFace {
  return { list: async () => snapshot as unknown as { entries: readonly PluginInventoryEntryFace[] } }
}

function presetsOf(
  compositions: readonly PluginInventoryPresetFace[],
  documents: Readonly<Record<string, string>> = {},
): AgentPresetsFace {
  return {
    serviceFor: () => undefined,
    compositionInventory: async () => compositions,
    readDocument: async (id: string) => {
      const content = documents[id]
      if (content === undefined) throw new Error('agent-preset/not-found')
      return { agentPreset: id, content }
    },
  }
}

function loaderEntry(id: string, config: unknown, enabled = true): LoaderEntryFace {
  return {
    id,
    disabled: !enabled,
    options: { id, name: MCP_MODULE, config },
  }
}

function httpConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    serverName: 'notes',
    transport: 'streamable-http',
    url: 'https://mcp.example.invalid/mcp',
    headers: { Authorization: 'Bearer header-secret-value' },
    ...overrides,
  }
}

/** 最小 session 替身：记录调用与关闭。 */
class FakeSession implements ProbeSession {
  readonly config: unknown
  connectCalls: { signal: AbortSignal; timeout: number }[] = []
  listCalls: { signal: AbortSignal; timeout: number }[] = []
  closed = 0
  constructor(
    config: unknown,
    private readonly behavior: {
      connect?: (options: { signal: AbortSignal; timeout: number }, session: FakeSession) => Promise<void>
      listTools?: (options: { signal: AbortSignal; timeout: number }, session: FakeSession) => Promise<{ supported: boolean; names: string[] }>
    } = {},
  ) {
    this.config = config
  }

  async connect(options: { signal: AbortSignal; timeout: number }): Promise<void> {
    this.connectCalls.push(options)
    await this.behavior.connect?.(options, this)
  }

  async listTools(options: { signal: AbortSignal; timeout: number }): Promise<{ supported: boolean; names: string[] }> {
    this.listCalls.push(options)
    return (await this.behavior.listTools?.(options, this)) ?? { supported: true, names: [] }
  }

  async close(): Promise<void> {
    this.closed += 1
  }
}

function waitAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    const onAbort = (): void => {
      const error = new Error('aborted by signal')
      error.name = 'AbortError'
      reject(error)
    }
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
  })
}

function readerOf(candidates: ProbeCandidate[]): ProbeConfigReaderFace {
  return {
    collect: async () => ({ candidates, available: true, profile: true, presets: true }),
  }
}

function candidate(overrides: Partial<ProbeCandidate> & { probeKey: string }): ProbeCandidate {
  return {
    scope: 'profile',
    entryId: 'mcp.notes',
    name: 'mcp.notes',
    enabled: true,
    probeAvailable: true,
    config: { transport: 'streamable-http', serverName: 'notes', url: 'https://mcp.invalid/mcp', headers: {} },
    ...overrides,
  }
}

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

const savedEnv = new Map<string, string | undefined>()
function setEnv(name: string, value: string): void {
  if (!savedEnv.has(name)) savedEnv.set(name, process.env[name])
  process.env[name] = value
}

afterEach(() => {
  for (const [name, value] of savedEnv) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  savedEnv.clear()
})

// ---------------------------------------------------------------------------
// 表达式求值 / stdio 环境
// ---------------------------------------------------------------------------

describe('纯 process.env 表达式求值（不执行任意 JS）', () => {
  it('支持 process.env、模板、拼接、||/?? 与比较', () => {
    setEnv('PROBE_TEST_NAME', 'world')
    expect(evaluateEnvExpression('process.env.PROBE_TEST_NAME')).toEqual({ ok: true, value: 'world' })
    expect(evaluateEnvExpression("'hello ' + process.env.PROBE_TEST_NAME")).toEqual({ ok: true, value: 'hello world' })
    expect(evaluateEnvExpression('`hello ${process.env.PROBE_TEST_NAME}`')).toEqual({ ok: true, value: 'hello world' })
    expect(evaluateEnvExpression("process.env.PROBE_MISSING || 'fallback'")).toEqual({ ok: true, value: 'fallback' })
    expect(evaluateEnvExpression("process.env.PROBE_MISSING ?? 'fallback'")).toEqual({ ok: true, value: 'fallback' })
    expect(evaluateEnvExpression("process.env.PROBE_TEST_NAME === 'world'")).toEqual({ ok: true, value: true })
    expect(evaluateEnvExpression("process.env.PROBE_TEST_NAME !== 'world'")).toEqual({ ok: true, value: false })
  })

  it('拒绝 ctx、函数调用、任意全局对象等非纯 process.env 表达式', () => {
    for (const source of [
      'ctx.secret',
      'process.env.HOME.trim()',
      'require("fs")',
      'globalThis.process.env.HOME',
      'process.env',
      '`x${ctx.value}`',
    ]) {
      expect(evaluateEnvExpression(source)).toEqual({ ok: false })
    }
  })

  it('缺失 env 参与模板/拼接时判为不可靠，不被当成 undefined/空串', () => {
    expect(evaluateEnvExpression('`Bearer ${process.env.PROBE_MISSING_TOKEN}`')).toEqual({ ok: false })
    expect(evaluateEnvExpression("process.env.PROBE_MISSING_TOKEN + 'suffix'")).toEqual({ ok: false })
  })
})

describe('stdio 子环境复刻 DSH scrubbedParentEnv', () => {
  const parent: NodeJS.ProcessEnv = {
    PATH: '/usr/bin',
    HOME: '/home/user',
    API_KEY: 'parent-key',
    DB_PASSWORD: 'parent-password',
    CLIENT_SECRET: 'parent-secret',
    GITHUB_TOKEN: 'parent-token',
    DSH_SESSION: 'internal',
    DSH_INTERNAL_FLAG: '1',
    SAFE_VALUE: 'keep',
  }

  it('剔除敏感名与 DSH_*，保留普通父环境', () => {
    const env = buildScrubbedChildEnv({}, parent)
    expect(env).toEqual({ PATH: '/usr/bin', HOME: '/home/user', SAFE_VALUE: 'keep' })
  })

  it('config.env 显式值覆盖同名父环境（包括敏感名）', () => {
    const env = buildScrubbedChildEnv({ SAFE_VALUE: 'config', API_KEY: 'config-key' }, parent)
    expect(env.SAFE_VALUE).toBe('config')
    expect(env.API_KEY).toBe('config-key')
    expect(env.DSH_SESSION).toBeUndefined()
    expect(env.DB_PASSWORD).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// 配置读取 / probeKey
// ---------------------------------------------------------------------------

describe('profile 根级探测配置（loader）', () => {
  it('读取真实传输配置并给出 profile 作用域的稳定 probeKey', async () => {
    const entryId = 'include:mcp-notes'
    const catalog = new McpCatalog({
      inventory: inventoryOf({
        entries: [{ entryId, moduleName: MCP_MODULE, enabled: true }],
      }),
      loader: loaderOf([loaderEntry(entryId, httpConfig())]),
    })
    const snap = await catalog.snapshot()
    const server = snap.servers[0]!
    expect(server.probeKey).toBe(`profile:${encodeURIComponent(entryId)}`)
    expect(server.probeAvailable).toBe(true)
    expect(server.probeUnavailableReason).toBeUndefined()
    expect(snap.probe).toEqual({
      available: true,
      manualOnly: true,
      maxConcurrent: PROBE_MAX_CONCURRENT,
      timeoutMs: PROBE_TIMEOUT_MS,
      profile: true,
      presets: false,
    })
  })

  it('敏感字段不进入快照 DTO：env/headers/token/command/URL 全不透出', async () => {
    const entryId = 'mcp.secret'
    const catalog = new McpCatalog({
      inventory: inventoryOf({
        entries: [{ entryId, moduleName: MCP_MODULE, enabled: true }],
      }),
      loader: loaderOf([
        loaderEntry(entryId, {
          serverName: 'secret',
          transport: 'stdio',
          command: '/private/bin/secret-server',
          args: ['--token', 'arg-secret'],
          env: { API_TOKEN: 'env-secret-value' },
          cwd: '/private/workdir',
        }),
      ]),
    })
    const snap = await catalog.snapshot()
    expect(snap.servers[0]!.probeAvailable).toBe(true)
    const wire = JSON.stringify(snap)
    for (const secret of ['env-secret-value', 'arg-secret', '/private/bin/secret-server', '/private/workdir']) {
      expect(wire).not.toContain(secret)
    }
    expect(Object.keys(snap.servers[0]!).sort()).toEqual([
      'configured',
      'enabled',
      'name',
      'probeAvailable',
      'probeKey',
      'scope',
      'source',
      'status',
    ])
  })

  it('仅实际启用条目可探测；禁用条目仍保留在总览中', async () => {
    const catalog = new McpCatalog({
      inventory: inventoryOf({
        entries: [
          { entryId: 'on', moduleName: MCP_MODULE, enabled: true },
          { entryId: 'off', moduleName: MCP_MODULE, enabled: false },
        ],
      }),
      loader: loaderOf([
        loaderEntry('on', httpConfig({ serverName: 'on' })),
        loaderEntry('off', httpConfig({ serverName: 'off' }), false),
      ]),
    })
    const snap = await catalog.snapshot()
    expect(snap.servers.map((server) => [server.name, server.probeAvailable, server.probeUnavailableReason])).toEqual([
      ['on', true, undefined],
      ['off', false, 'disabled'],
    ])
  })

  it('stdio 配置可探测：command/args/env 原样交给连接器（凭据不进入 wire）', async () => {
    let received: unknown
    const catalog = new McpCatalog({
      inventory: inventoryOf({ entries: [{ entryId: 'mcp.stdio', moduleName: MCP_MODULE, enabled: true }] }),
      loader: loaderOf([
        loaderEntry('mcp.stdio', {
          serverName: 'stdio',
          transport: 'stdio',
          command: '/usr/local/bin/mcp-server',
          args: ['--stdio'],
          env: { SERVER_API_KEY: 'stdio-secret' },
          cwd: '/workspace',
        }),
      ]),
      probeRuntime: {
        connector: (config) => {
          received = config
          return new FakeSession(config, { listTools: async () => ({ supported: true, names: ['stdio-tool'] }) })
        },
      },
    })
    const snap = await catalog.snapshot()
    expect(snap.servers[0]!.probeAvailable).toBe(true)
    expect(JSON.stringify(snap)).not.toContain('stdio-secret')
    const result = await catalog.probeByKey(snap.servers[0]!.probeKey)
    expect(result).toMatchObject({ ok: true, toolNames: ['stdio-tool'] })
    expect(received).toMatchObject({
      transport: 'stdio',
      command: '/usr/local/bin/mcp-server',
      args: ['--stdio'],
      env: { SERVER_API_KEY: 'stdio-secret' },
      cwd: '/workspace',
    })
  })

  it('不支持的 transport → 不可探测（unsupported_transport）', async () => {
    const catalog = new McpCatalog({
      inventory: inventoryOf({ entries: [{ entryId: 'mcp.sse', moduleName: MCP_MODULE, enabled: true }] }),
      loader: loaderOf([
        loaderEntry('mcp.sse', { serverName: 'sse', transport: 'sse', url: 'https://mcp.invalid/sse' }),
      ]),
    })
    const snap = await catalog.snapshot()
    expect(snap.servers[0]!.probeAvailable).toBe(false)
    expect(snap.servers[0]!.probeUnavailableReason).toBe('unsupported_transport')
  })

  it('配置文件表达式依赖私有 ctx → 不可探测（不猜值）', async () => {
    const catalog = new McpCatalog({
      inventory: inventoryOf({ entries: [{ entryId: 'ctx', moduleName: MCP_MODULE, enabled: true }] }),
      loader: loaderOf([
        loaderEntry('ctx', {
          serverName: 'ctx',
          transport: 'streamable-http',
          url: { __jsExpr: 'ctx.somePrivateValue' },
        }),
      ]),
    })
    const snap = await catalog.snapshot()
    expect(snap.servers[0]!.probeAvailable).toBe(false)
    expect(snap.servers[0]!.probeUnavailableReason).toBe('config_unresolved')
  })

  it('loader 缺失只降级探测：inventory 总览照常工作并给出 baseline probeKey', async () => {
    const snap = await new McpCatalog({
      inventory: inventoryOf({ entries: [{ entryId: 'mcp.notes', moduleName: MCP_MODULE, enabled: true }] }),
    }).snapshot()
    expect(snap.mode).toBe('config')
    expect(snap.servers[0]!.probeKey).toBe(probeKeyForEntry('profile', 'mcp.notes'))
    expect(snap.servers[0]!.probeAvailable).toBe(false)
    expect(snap.probe?.available).toBe(false)
    expect(snap.probe?.reason).toBe('config_source_unavailable')
  })
})

describe('agent preset 探测配置（compositionInventory + readDocument YAML）', () => {
  const preset = { id: 'ptc', name: 'PTC' }

  function presetCatalog(documents: Record<string, string>, rows?: readonly unknown[]): McpCatalog {
    const inventoryRows = rows ?? [{ entryId: 'preset.mcp', moduleName: MCP_MODULE, enabled: true }]
    return new McpCatalog({
      inventory: inventoryOf({
        entries: [],
        agentPresets: [{ ...preset, rows: inventoryRows }],
      }),
      presets: presetsOf(
        [{ ...preset, isDefault: true, rows: inventoryRows as PluginInventoryPresetFace['rows'] }],
        documents,
      ),
    })
  }

  it('读取 YAML 中的 streamable-http 配置并解析纯 env 模板；wire 不含凭据', async () => {
    setEnv('PROBE_ANYSEARCH_KEY', 'preset-env-secret')
    const content = `- id: preset.mcp
  name: '${MCP_MODULE}'
  config:
    serverName: anysearch
    transport: streamable-http
    url: 'https://mcp.example.invalid/mcp'
    headers:
      Authorization: !!js '\`Bearer \${process.env.PROBE_ANYSEARCH_KEY}\`'
`
    const catalog = presetCatalog({ ptc: content })
    const snap = await catalog.snapshot()
    expect(snap.servers[0]!.probeKey).toBe(`preset:${encodeURIComponent('ptc')}:${encodeURIComponent('preset.mcp')}`)
    expect(snap.servers[0]!.probeAvailable).toBe(true)
    expect(snap.probe?.presets).toBe(true)
    expect(JSON.stringify(snap)).not.toContain('preset-env-secret')
  })

  it('preset 的 disabled 表达式可求值为 false → 禁用不可探测；true → 可探测', async () => {
    setEnv('PROBE_PRESET_ENABLED', '0')
    const content = `- id: preset.mcp
  name: '${MCP_MODULE}'
  disabled: !!js process.env.PROBE_PRESET_ENABLED === '1'
  config:
    serverName: notes
    transport: streamable-http
    url: 'https://mcp.example.invalid/mcp'
`
    const rows = [{ entryId: 'preset.mcp', moduleName: MCP_MODULE, enabled: 'conditional' as const, condition: "process.env.PROBE_PRESET_ENABLED === '1'" }]
    const disabled = await presetCatalog({ ptc: content }, rows).snapshot()
    expect(disabled.servers[0]!.probeAvailable).toBe(false)
    expect(disabled.servers[0]!.probeUnavailableReason).toBe('disabled')

    setEnv('PROBE_PRESET_ENABLED', '1')
    const enabled = await presetCatalog({ ptc: content }, rows).snapshot()
    expect(enabled.servers[0]!.probeAvailable).toBe(true)
  })

  it('preset 的 disabled 表达式依赖 ctx → 条件启用不可探测（不猜 true/false）', async () => {
    const content = `- id: preset.mcp
  name: '${MCP_MODULE}'
  disabled: !!js ctx.privateFlag
  config:
    serverName: notes
    transport: streamable-http
    url: 'https://mcp.example.invalid/mcp'
`
    const rows = [{ entryId: 'preset.mcp', moduleName: MCP_MODULE, enabled: 'conditional' as const, condition: 'ctx.privateFlag' }]
    const snap = await presetCatalog({ ptc: content }, rows).snapshot()
    expect(snap.servers[0]!.enabled).toBe(true)
    expect(snap.servers[0]!.conditional).toBe(true)
    expect(snap.servers[0]!.probeAvailable).toBe(false)
    expect(snap.servers[0]!.probeUnavailableReason).toBe('conditional')
  })

  it('preset 配置表达式依赖 ctx → config_unresolved，不猜 URL/凭据', async () => {
    const content = `- id: preset.mcp
  name: '${MCP_MODULE}'
  config:
    serverName: notes
    transport: streamable-http
    url: !!js ctx.privateUrl
`
    const snap = await presetCatalog({ ptc: content }).snapshot()
    expect(snap.servers[0]!.probeAvailable).toBe(false)
    expect(snap.servers[0]!.probeUnavailableReason).toBe('config_unresolved')
  })

  it('readDocument 缺失/失败只降级 preset 探测：条目仍展示且 probeKey 稳定', async () => {
    const catalog = new McpCatalog({
      inventory: inventoryOf({
        entries: [],
        agentPresets: [{ id: 'ptc', rows: [{ entryId: 'preset.mcp', moduleName: MCP_MODULE, enabled: true }] }],
      }),
      presets: {
        serviceFor: () => undefined,
        compositionInventory: async () => [{ id: 'ptc', rows: [{ entryId: 'preset.mcp', moduleName: MCP_MODULE, enabled: true }] }],
      },
    })
    const snap = await catalog.snapshot()
    expect(snap.servers[0]!.name).toBe('preset.mcp')
    expect(snap.servers[0]!.probeKey).toBe(`preset:${encodeURIComponent('ptc')}:${encodeURIComponent('preset.mcp')}`)
    expect(snap.servers[0]!.probeAvailable).toBe(false)
    expect(snap.probe?.presets).toBe(false)
  })

  it('同一 preset 内重复/空 id 稳定消歧：key 追加 #1/#2，跨作用域同名不冲突', async () => {
    const content = `- name: '${MCP_MODULE}'
  config:
    serverName: first
    transport: streamable-http
    url: 'https://mcp.example.invalid/one'
- name: '${MCP_MODULE}'
  config:
    serverName: second
    transport: streamable-http
    url: 'https://mcp.example.invalid/two'
`
    const rows = [
      { entryId: null, moduleName: MCP_MODULE, enabled: true },
      { entryId: null, moduleName: MCP_MODULE, enabled: true },
    ]
    const catalog = presetCatalog({ ptc: content }, rows)
    const snap = await catalog.snapshot()
    expect(snap.servers).toHaveLength(1)
    expect(snap.servers[0]!.probeKey).toBe(
      `preset:${encodeURIComponent('ptc')}:${encodeURIComponent(MCP_MODULE)}#1`,
    )
    const reader = new McpProbeConfigReader({
      presets: presetsOf([{ id: 'ptc', rows }], { ptc: content }),
    })
    const collection = await reader.collect()
    expect(collection.candidates.map((item) => item.probeKey)).toEqual([
      `preset:${encodeURIComponent('ptc')}:${encodeURIComponent(MCP_MODULE)}#1`,
      `preset:${encodeURIComponent('ptc')}:${encodeURIComponent(MCP_MODULE)}#2`,
    ])
  })

  it('profile 与 preset 的同名条目 key 不同（不以 name 作跨作用域唯一键）', async () => {
    const catalog = new McpCatalog({
      inventory: inventoryOf({
        entries: [{ entryId: 'same', moduleName: MCP_MODULE, enabled: true }],
        agentPresets: [{ id: 'ptc', rows: [{ entryId: 'same', moduleName: MCP_MODULE, enabled: true }] }],
      }),
      loader: loaderOf([loaderEntry('same', httpConfig())]),
      presets: presetsOf(
        [{ id: 'ptc', rows: [{ entryId: 'same', moduleName: MCP_MODULE, enabled: true }] }],
        {
          ptc: `- id: same
  name: '${MCP_MODULE}'
  config:
    serverName: same
    transport: streamable-http
    url: 'https://mcp.example.invalid/same'
`,
        },
      ),
    })
    const snap = await catalog.snapshot()
    expect(snap.servers.map((server) => server.probeKey)).toEqual([
      `profile:${encodeURIComponent('same')}`,
      `preset:${encodeURIComponent('ptc')}:${encodeURIComponent('same')}`,
    ])
  })
})

// ---------------------------------------------------------------------------
// 探测运行时
// ---------------------------------------------------------------------------

describe('手动单条探测运行时', () => {
  it('成功返回 probedAt/durationMs/toolNames/toolCount，并关闭连接', async () => {
    const sessions: FakeSession[] = []
    const service = new McpProbeService(readerOf([candidate({ probeKey: 'profile:notes' })]), {
      connector: (config) => {
        const session = new FakeSession(config, {
          listTools: async () => ({ supported: true, names: ['search', 'fetch'] }),
        })
        sessions.push(session)
        return session
      },
    })
    const result = await service.probe('profile:notes')
    expect(result).toMatchObject({
      ok: true,
      probeKey: 'profile:notes',
      scope: 'profile',
      entryId: 'mcp.notes',
      toolNames: ['search', 'fetch'],
      toolCount: 2,
    })
    expect(result.ok && result.probedAt).toBeTypeOf('number')
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
    expect(sessions[0]!.connectCalls).toHaveLength(1)
    expect(sessions[0]!.connectCalls[0]!.timeout).toBeGreaterThan(0)
    expect(sessions[0]!.connectCalls[0]!.timeout).toBeLessThanOrEqual(PROBE_TIMEOUT_MS)
    expect(sessions[0]!.listCalls[0]!.timeout).toBeGreaterThan(0)
    expect(sessions[0]!.listCalls[0]!.timeout).toBeLessThanOrEqual(PROBE_TIMEOUT_MS)
    expect(sessions[0]!.closed).toBe(1)
  })

  it('0 工具是成功（toolNames=[]，toolCount=0）', async () => {
    const service = new McpProbeService(readerOf([candidate({ probeKey: 'profile:notes' })]), {
      connector: (config) => new FakeSession(config, { listTools: async () => ({ supported: true, names: [] }) }),
    })
    const result = await service.probe('profile:notes')
    expect(result).toMatchObject({ ok: true, toolNames: [], toolCount: 0 })
  })

  it('无 tools 能力按 0 工具成功（session 不调用 listTools 也成功）', async () => {
    const service = new McpProbeService(readerOf([candidate({ probeKey: 'profile:notes' })]), {
      connector: (config) => new FakeSession(config, { listTools: async () => ({ supported: false, names: [] }) }),
    })
    expect(await service.probe('profile:notes')).toMatchObject({ ok: true, toolNames: [] })
  })

  it('connect 失败 → code=connect，仍关闭 session，message 不含原始错误/URL/凭据', async () => {
    let closed = 0
    const service = new McpProbeService(readerOf([candidate({ probeKey: 'profile:notes' })]), {
      connector: (config) => {
        const session = new FakeSession(config, {
          connect: async () => {
            throw new Error('connect failed https://user:token@mcp.invalid/private token=super-secret')
          },
        })
        const close = session.close.bind(session)
        session.close = async () => {
          closed += 1
          await close()
        }
        return session
      },
    })
    const result = await service.probe('profile:notes')
    expect(result).toMatchObject({ ok: false, code: 'connect', stage: 'connect' })
    expect(JSON.stringify(result)).not.toContain('super-secret')
    expect(JSON.stringify(result)).not.toContain('mcp.invalid')
    expect(closed).toBe(1)
  })

  it('listTools 失败 → code=tools_list，仍关闭 session', async () => {
    let closed = 0
    const service = new McpProbeService(readerOf([candidate({ probeKey: 'profile:notes' })]), {
      connector: (config) => {
        const session = new FakeSession(config, {
          listTools: async () => {
            throw new Error('tools/list exploded')
          },
        })
        const close = session.close.bind(session)
        session.close = async () => {
          closed += 1
          await close()
        }
        return session
      },
    })
    const result = await service.probe('profile:notes')
    expect(result).toMatchObject({ ok: false, code: 'tools_list', stage: 'tools_list' })
    expect(JSON.stringify(result)).not.toContain('tools/list exploded')
    expect(closed).toBe(1)
  })

  it('单条超时 → code=timeout，关闭连接（默认 10s；测试注入更短预算）', async () => {
    let closed = 0
    const service = new McpProbeService(readerOf([candidate({ probeKey: 'profile:notes' })]), {
      timeoutMs: 30,
      connector: (config) => {
        const session = new FakeSession(config, { connect: async (options) => waitAbort(options.signal) })
        const close = session.close.bind(session)
        session.close = async () => {
          closed += 1
          await close()
        }
        return session
      },
    })
    const result = await service.probe('profile:notes')
    expect(result).toMatchObject({ ok: false, code: 'timeout', stage: 'timeout' })
    expect(result.ok === false && result.message).toContain('30')
    expect(closed).toBe(1)
  })

  it('外部 AbortSignal → code=cancelled，关闭连接', async () => {
    let closed = 0
    const service = new McpProbeService(readerOf([candidate({ probeKey: 'profile:notes' })]), {
      timeoutMs: 5_000,
      connector: (config) => {
        const session = new FakeSession(config, { connect: async (options) => waitAbort(options.signal) })
        const close = session.close.bind(session)
        session.close = async () => {
          closed += 1
          await close()
        }
        return session
      },
    })
    const controller = new AbortController()
    const promise = service.probe('profile:notes', { signal: controller.signal })
    await tick()
    controller.abort()
    expect(await promise).toMatchObject({ ok: false, code: 'cancelled', stage: 'cancelled' })
    expect(closed).toBe(1)
  })

  it('已取消的信号在开始前直接返回 cancelled，不创建连接', async () => {
    let connections = 0
    const service = new McpProbeService(readerOf([candidate({ probeKey: 'profile:notes' })]), {
      connector: (config) => {
        connections += 1
        return new FakeSession(config)
      },
    })
    const controller = new AbortController()
    controller.abort()
    expect(await service.probe('profile:notes', { signal: controller.signal })).toMatchObject({
      ok: false,
      code: 'cancelled',
    })
    expect(connections).toBe(0)
  })

  it('同 probeKey 并发去重：共享同一次底层连接（每个调用者独立 promise）', async () => {
    let connections = 0
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const service = new McpProbeService(readerOf([candidate({ probeKey: 'profile:notes' })]), {
      connector: (config) => {
        connections += 1
        return new FakeSession(config, { connect: async () => gate })
      },
    })
    const first = service.probe('profile:notes')
    const second = service.probe('profile:notes')
    // 取消是调用者级的：每个调用者拿到自己的 promise，底层操作只跑一次。
    expect(second).not.toBe(first)
    await tick()
    release?.()
    const [a, b] = await Promise.all([first, second])
    expect(a).toMatchObject({ ok: true })
    expect(b).toEqual(a)
    expect(connections).toBe(1)
  })

  it('Host 全局并发上限 2：第三个请求排队，前一个结束后才开始', async () => {
    let active = 0
    let peak = 0
    let started = 0
    const releases: (() => void)[] = []
    const service = new McpProbeService(
      readerOf(['a', 'b', 'c'].map((name) => candidate({ probeKey: `profile:${name}`, name, entryId: name }))),
      {
        maxConcurrent: 2,
        connector: (config) => {
          started += 1
          return new FakeSession(config, {
            connect: async () => {
              active += 1
              peak = Math.max(peak, active)
              await new Promise<void>((resolve) => releases.push(resolve))
              active -= 1
            },
          })
        },
      },
    )
    const probes = ['a', 'b', 'c'].map((name) => service.probe(`profile:${name}`))
    await tick()
    await tick()
    expect(started).toBe(2)
    expect(peak).toBe(2)
    releases.shift()?.()
    await tick()
    await tick()
    expect(started).toBe(3)
    releases.shift()?.()
    releases.shift()?.()
    const results = await Promise.all(probes)
    expect(results.every((result) => result.ok)).toBe(true)
    expect(peak).toBe(2)
  })

  it('禁用/不可用条目在连接前返回稳定 code，不创建连接', async () => {
    let connections = 0
    const service = new McpProbeService(
      readerOf([
        candidate({ probeKey: 'profile:off', probeAvailable: false, probeUnavailableReason: 'disabled' }),
        candidate({ probeKey: 'profile:ctx', probeAvailable: false, probeUnavailableReason: 'config_unresolved' }),
      ]),
      {
        connector: (config) => {
          connections += 1
          return new FakeSession(config)
        },
      },
    )
    expect(await service.probe('profile:off')).toMatchObject({ ok: false, code: 'disabled', stage: 'disabled' })
    expect(await service.probe('profile:ctx')).toMatchObject({ ok: false, code: 'unavailable', stage: 'unavailable' })
    expect(connections).toBe(0)
  })

  it('未知 probeKey / 配置面不可用 → unavailable', async () => {
    const service = new McpProbeService(readerOf([]), { connector: (config) => new FakeSession(config) })
    expect(await service.probe('profile:missing')).toMatchObject({ ok: false, code: 'unavailable' })
    const unavailable = new McpProbeService(
      { collect: async () => ({ candidates: [], available: false, profile: false, presets: false, reason: 'config_source_unavailable' }) },
      { connector: (config) => new FakeSession(config) },
    )
    expect(await unavailable.probe('profile:missing')).toMatchObject({ ok: false, code: 'unavailable' })
  })

  it('dispose 中止在途探测、等待关闭并拒绝后续探测', async () => {
    let closed = 0
    const service = new McpProbeService(readerOf([candidate({ probeKey: 'profile:notes' })]), {
      timeoutMs: 5_000,
      connector: (config) => {
        const session = new FakeSession(config, { connect: async (options) => waitAbort(options.signal) })
        const close = session.close.bind(session)
        session.close = async () => {
          closed += 1
          await close()
        }
        return session
      },
    })
    const pending = service.probe('profile:notes')
    await tick()
    const disposing = service.dispose()
    expect(await pending).toMatchObject({ ok: false, code: 'cancelled' })
    await disposing
    expect(closed).toBe(1)
    expect(await service.probe('profile:notes')).toMatchObject({ ok: false, code: 'unavailable' })
  })
})

// ---------------------------------------------------------------------------
// Catalog 级探测（probeKey → probe service）
// ---------------------------------------------------------------------------

describe('Catalog 显式探测（probeKey，快照不触发）', () => {
  it('按 probeKey 探测成功；快照读取本身绝不连接', async () => {
    let connections = 0
    const catalog = new McpCatalog({
      inventory: inventoryOf({ entries: [{ entryId: 'mcp.notes', moduleName: MCP_MODULE, enabled: true }] }),
      loader: loaderOf([loaderEntry('mcp.notes', httpConfig())]),
      probeRuntime: {
        connector: (config) => {
          connections += 1
          return new FakeSession(config, { listTools: async () => ({ supported: true, names: ['t'] }) })
        },
      },
    })
    const snap = await catalog.snapshot()
    expect(connections).toBe(0)
    const result = await catalog.probeByKey(snap.servers[0]!.probeKey)
    expect(result).toMatchObject({ ok: true, toolNames: ['t'], scope: 'profile' })
    expect(connections).toBe(1)
  })

  it('preset 条目按 probeKey 探测成功，失败/成功均带作用域身份', async () => {
    const catalog = new McpCatalog({
      inventory: inventoryOf({
        entries: [],
        agentPresets: [{ id: 'ptc', rows: [{ entryId: 'preset.mcp', moduleName: MCP_MODULE, enabled: true }] }],
      }),
      presets: presetsOf(
        [{ id: 'ptc', rows: [{ entryId: 'preset.mcp', moduleName: MCP_MODULE, enabled: true }] }],
        {
          ptc: `- id: preset.mcp
  name: '${MCP_MODULE}'
  config:
    serverName: notes
    transport: streamable-http
    url: 'https://mcp.example.invalid/mcp'
`,
        },
      ),
      probeRuntime: { connector: (config) => new FakeSession(config) },
    })
    const snap = await catalog.snapshot()
    const result = await catalog.probeByKey(snap.servers[0]!.probeKey)
    expect(result).toMatchObject({ ok: true, scope: 'preset', presetId: 'ptc', entryId: 'preset.mcp' })
  })

  it('托管路径兼容：managed probeKey 走官方 mcpManager.probe', async () => {
    const catalog = new McpCatalog({
      manager: {
        list: async () => [{ name: 'notes', configured: true, status: { state: 'connected', toolCount: 2 } }],
        probe: async (server: string) => ({ ok: true, toolNames: [`${server}-tool`] }),
      },
    })
    const snap = await catalog.snapshot()
    expect(snap.servers[0]!.probeKey).toBe('managed:notes')
    expect(await catalog.probeByKey('managed:notes')).toMatchObject({ ok: true, toolNames: ['notes-tool'] })
  })

  it('托管失败不透传 manager 原始 message', async () => {
    const catalog = new McpCatalog({
      manager: {
        list: async () => [{ name: 'notes', configured: true, status: { state: 'failed', reason: 'x' } }],
        probe: async () => ({ ok: false, stage: 'connect', message: 'https://token@mcp.invalid secret' }),
      },
    })
    const result = await catalog.probe('notes')
    expect(result).toMatchObject({ ok: false, code: 'connect' })
    expect(JSON.stringify(result)).not.toContain('token@mcp.invalid')
  })
})

// 类型守卫：确保公开响应联合可被消费方按 ok 分支。
function assertResponseShape(response: McpProbeResponse): string[] {
  return response.ok ? response.toolNames : [response.code, response.stage, response.message]
}

describe('响应契约形状', () => {
  it('成功/失败联合都保留 ok 判别与稳定字段', () => {
    const entry: McpServerEntry['probeKey'] = probeKeyForEntry('profile', 'x')
    expect(entry).toBe('profile:x')
    expect(assertResponseShape({ ok: true, probeKey: 'p', scope: 'profile', entryId: null, probedAt: 1, durationMs: 1, toolNames: [], toolCount: 0 })).toEqual([])
    expect(assertResponseShape({ ok: false, probeKey: 'p', stage: 'connect', code: 'connect', message: 'm', durationMs: 0 })).toEqual(['connect', 'connect', 'm'])
  })
})
