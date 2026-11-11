/**
 * 独立 MCP 探测的生命周期 / 取消回归测试（Host 独立审查发现的边界）。
 *
 * 每个用例都用**真实的注入替身**复现问题形态，而不是“立即 resolve 的
 * Fake”：
 * - close 永不 resolve、close 直接抛错；
 * - collect 永不 resolve（probe 与 overview 两条路径）；
 * - 同一 probeKey 的两个调用者各自持有不同 signal；
 * - SDK 完全忽略 AbortSignal，只有 `cancel()` 能打断协商；
 * - 时钟越过 deadline 后底层才返回“成功”；
 * - 并发 dispose、批量 single-flight 与 TTL 失效；
 * - disabled/broken/conditional 条目的敏感字段不被求值；
 * - stdio 子环境的代理覆盖层与官方 `scrubbedHost` 语义一致；
 * - 托管路径真正复用 10s / 并发 2 / 取消 / dispose。
 *
 * 所有连接仍由注入 connector 模拟：不启动真实 MCP、不访问网络。
 */
import { describe, expect, it } from 'vitest'
import { McpCatalog } from '../src/host/mcp.ts'
import { McpProbeConfigReader, type ProbeCandidate, type ProbeConfigCollection, type ProbeConfigReaderFace } from '../src/host/mcp-config.ts'
import {
  buildScrubbedChildEnv,
  McpProbeService,
  PROBE_CLOSE_TIMEOUT_MS,
  PROBE_CONFIG_CACHE_MS,
  PROBE_CONFIG_TIMEOUT_MS,
  PROBE_MAX_CONCURRENT,
  PROBE_TIMEOUT_MS,
  proxyEnvironmentForChild,
  type ProbeSession,
} from '../src/host/mcp-probe.ts'
import type { McpProbeOutcomeFace, PluginInventoryEntryFace, PluginInventoryFace } from '../src/host/services.ts'

const MCP_MODULE = '@deepseek-ai/dsh-mcp-client'

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
  let resolve: (value: T) => void = () => undefined
  let reject: (error: unknown) => void = () => undefined
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function never<T>(): Promise<T> {
  return new Promise<T>(() => undefined)
}

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/** 轮询等待（避免依赖固定的 tick 次数）。 */
async function until(predicate: () => boolean, label: string): Promise<void> {
  for (let index = 0; index < 200; index += 1) {
    if (predicate()) return
    await tick()
  }
  throw new Error(`等待超时：${label}`)
}

function waitAbort(signal: AbortSignal): Promise<never> {
  return new Promise<never>((_, reject) => {
    const onAbort = (): void => {
      const error = new Error('aborted by signal')
      error.name = 'AbortError'
      reject(error)
    }
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
  })
}

interface SessionBehavior {
  connect?: (options: { signal: AbortSignal; timeout: number }, session: FakeSession) => Promise<void>
  listTools?: (options: { signal: AbortSignal; timeout: number }, session: FakeSession) => Promise<{ supported: boolean; names: string[] }>
  close?: (session: FakeSession) => Promise<void>
  cancel?: (session: FakeSession) => void
}

/** 记录调用与关闭的 session 替身；行为全部由用例注入。 */
class FakeSession implements ProbeSession {
  readonly config: unknown
  connectCalls: { signal: AbortSignal; timeout: number }[] = []
  listCalls: { signal: AbortSignal; timeout: number }[] = []
  closed = 0
  cancelCalls = 0

  constructor(
    config: unknown,
    private readonly behavior: SessionBehavior = {},
  ) {
    this.config = config
  }

  async connect(options: { signal: AbortSignal; timeout: number }): Promise<void> {
    this.connectCalls.push(options)
    await this.behavior.connect?.(options, this)
  }

  async listTools(options: { signal: AbortSignal; timeout: number }): Promise<{ supported: boolean; names: string[] }> {
    this.listCalls.push(options)
    return (await this.behavior.listTools?.(options, this)) ?? { supported: true, names: ['tool'] }
  }

  async close(): Promise<void> {
    this.closed += 1
    await this.behavior.close?.(this)
  }

  cancel(): void {
    this.cancelCalls += 1
    this.behavior.cancel?.(this)
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

interface CollectingReader extends ProbeConfigReaderFace {
  calls: number
}

/** 配置读取替身：记录调用次数，可注入挂起/失败。 */
function collectingReader(candidates: ProbeCandidate[], hook?: () => Promise<void>): CollectingReader {
  const reader: CollectingReader = {
    calls: 0,
    async collect(): Promise<ProbeConfigCollection> {
      reader.calls += 1
      if (hook !== undefined) await hook()
      return { candidates, available: true, profile: true, presets: false }
    },
  }
  return reader
}

function inventoryOf(entries: readonly unknown[]): PluginInventoryFace {
  return { list: async () => ({ entries: entries as readonly PluginInventoryEntryFace[] }) }
}

// ---------------------------------------------------------------------------
// 契约常量
// ---------------------------------------------------------------------------

describe('探测生命周期契约常量', () => {
  it('声明的限制与实际一致：10s 预算、并发 2、500ms 关闭上界、2s 配置上界/缓存', () => {
    expect(PROBE_TIMEOUT_MS).toBe(10_000)
    expect(PROBE_MAX_CONCURRENT).toBe(2)
    expect(PROBE_CLOSE_TIMEOUT_MS).toBe(500)
    expect(PROBE_CONFIG_TIMEOUT_MS).toBe(2_000)
    expect(PROBE_CONFIG_CACHE_MS).toBe(2_000)
    expect(PROBE_CONFIG_CACHE_MS).toBeLessThanOrEqual(2_000)
  })
})

// ---------------------------------------------------------------------------
// P0-1：close 有界
// ---------------------------------------------------------------------------

describe('close 有明确短上界（挂住的 close 不拖住任何东西）', () => {
  it('close 永不 resolve：结果立即返回、槽位释放、dispose 正常结束', async () => {
    const sessions: FakeSession[] = []
    const service = new McpProbeService(collectingReader([candidate({ probeKey: 'profile:a' }), candidate({ probeKey: 'profile:b', entryId: 'b', name: 'b' })]), {
      maxConcurrent: 1,
      timeoutMs: 5_000,
      closeTimeoutMs: 25,
      connector: (config) => {
        const session = new FakeSession(config, { close: () => never() })
        sessions.push(session)
        return session
      },
    })
    const firstStarted = Date.now()
    expect(await service.probe('profile:a')).toMatchObject({ ok: true })
    expect(Date.now() - firstStarted).toBeLessThan(300)

    // maxConcurrent=1：若释放等待 close，第二个探测会一直排队。
    const secondStarted = Date.now()
    expect(await service.probe('profile:b')).toMatchObject({ ok: true })
    expect(Date.now() - secondStarted).toBeLessThan(300)
    expect(sessions).toHaveLength(2)

    const disposeStarted = Date.now()
    await service.dispose()
    expect(Date.now() - disposeStarted).toBeLessThan(300)
    // 后台 close 确实被调用（只是被上界截断），不会被跳过。
    expect(sessions.map((session) => session.closed)).toEqual([1, 1])
  })

  it('close 直接抛错：探测结果不受影响，且不产生未处理拒绝', async () => {
    const service = new McpProbeService(collectingReader([candidate({ probeKey: 'profile:notes' })]), {
      closeTimeoutMs: 25,
      connector: (config) =>
        new FakeSession(config, {
          close: async () => {
            throw new Error('close exploded for https://token@mcp.invalid')
          },
        }),
    })
    const result = await service.probe('profile:notes')
    expect(result).toMatchObject({ ok: true })
    expect(JSON.stringify(result)).not.toContain('mcp.invalid')
    await service.dispose()
  })

  it('close 挂住时 dispose 只等到 close 上界，不等它真正结束', async () => {
    const sessions: FakeSession[] = []
    const service = new McpProbeService(collectingReader([candidate({ probeKey: 'profile:notes' })]), {
      closeTimeoutMs: 10,
      connector: (config) => {
        const session = new FakeSession(config, { close: () => never() })
        sessions.push(session)
        return session
      },
    })
    const pending = service.probe('profile:notes')
    await until(() => sessions.length === 1 && sessions[0]!.closed === 1, 'close 已发起（并挂住）')
    const started = Date.now()
    await service.dispose()
    await pending
    expect(Date.now() - started).toBeLessThan(300)
    expect(sessions[0]!.closed).toBe(1)
  })

  it('dispose 时排队的探测也被取消（不留下永久的 waiter）', async () => {
    const sessions: FakeSession[] = []
    const service = new McpProbeService(
      collectingReader([candidate({ probeKey: 'profile:a' }), candidate({ probeKey: 'profile:b', entryId: 'b', name: 'b' })]),
      {
        maxConcurrent: 1,
        timeoutMs: 5_000,
        closeTimeoutMs: 20,
        connector: (config) => {
          const session = new FakeSession(config, { connect: async (options) => waitAbort(options.signal) })
          sessions.push(session)
          return session
        },
      },
    )
    const first = service.probe('profile:a')
    await until(() => sessions.length === 1, '第一个探测已建立连接')
    const queued = service.probe('profile:b')
    await tick()
    expect(sessions).toHaveLength(1) // 第二个仍在等槽位

    const disposing = service.dispose()
    expect(await first).toMatchObject({ code: 'cancelled' })
    expect(await queued).toMatchObject({ code: 'cancelled' })
    await disposing
    expect(sessions).toHaveLength(1)
    expect(sessions[0]!.closed).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// P0-2：collect 可取消 / 有上界 / single-flight / TTL
// ---------------------------------------------------------------------------

describe('配置收集有上界且不会被无限挂起', () => {
  it('collect 永不 resolve：probe 在配置上界内失败（不占满 10s 预算）', async () => {
    const service = new McpProbeService(
      { collect: () => never() },
      { configTimeoutMs: 30, timeoutMs: 5_000 },
    )
    const started = Date.now()
    const result = await service.probe('profile:notes')
    expect(result).toMatchObject({ ok: false, code: 'unavailable' })
    expect(Date.now() - started).toBeLessThan(500)
  })

  it('collect 永不 resolve：overview 在短上界内降级 probe，服务器列表照常返回', async () => {
    const catalog = new McpCatalog({
      inventory: inventoryOf([{ entryId: 'mcp.notes', moduleName: MCP_MODULE, enabled: true }]),
      probeReader: { collect: () => never() },
      probeRuntime: { configTimeoutMs: 30 },
    })
    const started = Date.now()
    const snapshot = await catalog.snapshot()
    expect(Date.now() - started).toBeLessThan(500)
    expect(snapshot.servers).toHaveLength(1)
    expect(snapshot.servers[0]!.probeAvailable).toBe(false)
    expect(snapshot.probe?.available).toBe(false)
  })

  it('批量探测与 overview 共享一次收集（single-flight），TTL 过后才重新读取', async () => {
    let clock = 1_000
    const gate = deferred<void>()
    const candidates = [
      candidate({ probeKey: 'profile:a', entryId: 'a', name: 'a' }),
      candidate({ probeKey: 'profile:b', entryId: 'b', name: 'b' }),
      candidate({ probeKey: 'profile:c', entryId: 'c', name: 'c' }),
    ]
    const reader = collectingReader(candidates, () => gate.promise)
    const service = new McpProbeService(reader, {
      now: () => clock,
      configCacheMs: 20,
      connector: (config) => new FakeSession(config),
    })

    const probes = candidates.map((item) => service.probe(item.probeKey))
    const overview = service.collectConfig()
    await until(() => reader.calls === 1, '首次 collect 已发起')
    gate.resolve()
    const [a, b, c] = await Promise.all(probes)
    await overview
    expect([a, b, c].every((result) => result.ok)).toBe(true)
    expect(reader.calls).toBe(1)

    // TTL 内继续复用。
    await service.collectConfig()
    expect(reader.calls).toBe(1)

    // 配置变化不会长期错误复用：TTL 过后必然重新读取。
    clock += 25
    await service.collectConfig()
    expect(reader.calls).toBe(2)
    await service.dispose()
  })

  it('collect 失败不入缓存（短暂失败可立即重试）', async () => {
    let attempts = 0
    const service = new McpProbeService(
      {
        async collect() {
          attempts += 1
          if (attempts === 1) throw new Error('transient')
          return { candidates: [], available: true, profile: true, presets: false }
        },
      },
      { connector: (config) => new FakeSession(config) },
    )
    await expect(service.collectConfig()).rejects.toThrow()
    await expect(service.collectConfig()).resolves.toMatchObject({ available: true })
    expect(attempts).toBe(2)
  })

  it('invalidateConfig 立即丢弃缓存（不等待 TTL）', async () => {
    const reader = collectingReader([])
    const service = new McpProbeService(reader, { configCacheMs: 60_000 })
    await service.collectConfig()
    service.invalidateConfig()
    await service.collectConfig()
    expect(reader.calls).toBe(2)
  })

  it('配置面变化（attachServices）会失效探测缓存', async () => {
    let loads = 0
    const catalog = new McpCatalog({
      inventory: inventoryOf([{ entryId: 'mcp.notes', moduleName: MCP_MODULE, enabled: true }]),
      probeRuntime: { configCacheMs: 60_000 },
    })
    catalog.attachServices({
      loader: {
        entries: () => {
          loads += 1
          return []
        },
      },
    })
    await catalog.snapshot()
    const afterFirst = loads
    await catalog.snapshot()
    expect(loads).toBe(afterFirst)
    catalog.detachServices(['loader'])
    await catalog.snapshot()
    expect(loads).toBe(afterFirst)
    catalog.attachServices({
      loader: {
        entries: () => {
          loads += 1
          return []
        },
      },
    })
    await catalog.snapshot()
    expect(loads).toBe(afterFirst + 1)
  })
})

// ---------------------------------------------------------------------------
// P0-3：调用者级取消
// ---------------------------------------------------------------------------

describe('同一 probeKey 的调用者级取消（引用计数）', () => {
  it('A 取消不影响 B：B 照常拿结果，底层只连接一次且未被 abort', async () => {
    const gate = deferred<void>()
    const sessions: FakeSession[] = []
    const service = new McpProbeService(collectingReader([candidate({ probeKey: 'profile:notes' })]), {
      timeoutMs: 5_000,
      connector: (config) => {
        const session = new FakeSession(config, {
          connect: async () => {
            await gate.promise
          },
          listTools: async () => ({ supported: true, names: ['search'] }),
        })
        sessions.push(session)
        return session
      },
    })
    const first = new AbortController()
    const second = new AbortController()
    const a = service.probe('profile:notes', { signal: first.signal })
    const b = service.probe('profile:notes', { signal: second.signal })
    await until(() => sessions.length === 1, '连接已建立')

    first.abort()
    expect(await a).toMatchObject({ ok: false, code: 'cancelled', stage: 'cancelled' })
    // 底层操作仍在进行：B 的 signal 与其连接都未受影响。
    expect(second.signal.aborted).toBe(false)
    expect(sessions[0]!.connectCalls[0]!.signal.aborted).toBe(false)

    gate.resolve()
    expect(await b).toMatchObject({ ok: true, toolNames: ['search'] })
    expect(sessions).toHaveLength(1)
    expect(sessions[0]!.closed).toBe(1)
    await service.dispose()
  })

  it('只有最后一个调用者取消时才 abort 底层并清理 inFlight', async () => {
    const sessions: FakeSession[] = []
    let connections = 0
    const service = new McpProbeService(collectingReader([candidate({ probeKey: 'profile:notes' })]), {
      timeoutMs: 5_000,
      connector: (config) => {
        connections += 1
        const hanging = connections === 1
        const session = new FakeSession(config, {
          connect: hanging ? async (options) => waitAbort(options.signal) : async () => undefined,
        })
        sessions.push(session)
        return session
      },
    })
    const first = new AbortController()
    const second = new AbortController()
    const a = service.probe('profile:notes', { signal: first.signal })
    const b = service.probe('profile:notes', { signal: second.signal })
    await until(() => sessions.length === 1, '连接已建立')

    first.abort()
    expect(await a).toMatchObject({ code: 'cancelled' })
    expect(sessions[0]!.connectCalls[0]!.signal.aborted).toBe(false)

    second.abort()
    expect(await b).toMatchObject({ code: 'cancelled' })
    await until(() => sessions[0]!.connectCalls[0]!.signal.aborted, '最后一个调用者退出后才 abort 底层')

    // 底层清理完毕：新探测建立新连接。
    expect(await service.probe('profile:notes')).toMatchObject({ ok: true })
    expect(connections).toBe(2)
    await service.dispose()
  })

  it('单个调用者取消立即返回 cancelled（不等待底层 settle）', async () => {
    const service = new McpProbeService(collectingReader([candidate({ probeKey: 'profile:notes' })]), {
      timeoutMs: 5_000,
      connector: (config) => new FakeSession(config, { connect: async () => never() }),
    })
    const controller = new AbortController()
    const pending = service.probe('profile:notes', { signal: controller.signal })
    await tick()
    const started = Date.now()
    controller.abort()
    expect(await pending).toMatchObject({ code: 'cancelled' })
    expect(Date.now() - started).toBeLessThan(200)
    await service.dispose()
  })

  it('已取消的调用者不建立连接，也不影响同键的后来者', async () => {
    let connections = 0
    const service = new McpProbeService(collectingReader([candidate({ probeKey: 'profile:notes' })]), {
      connector: (config) => {
        connections += 1
        return new FakeSession(config)
      },
    })
    const aborted = new AbortController()
    aborted.abort()
    expect(await service.probe('profile:notes', { signal: aborted.signal })).toMatchObject({ code: 'cancelled' })
    expect(connections).toBe(0)
    expect(await service.probe('profile:notes')).toMatchObject({ ok: true })
    expect(connections).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// P1-4：SDK 忽略 signal 时仍能 settle / cancel 生效
// ---------------------------------------------------------------------------

describe('SDK 忽略 AbortSignal 时的取消与超时', () => {
  it('abort 立即调用 session.cancel()（关闭 transport 打断协商）并让探测 settle', async () => {
    const negotiation = deferred<void>()
    const sessions: FakeSession[] = []
    const service = new McpProbeService(collectingReader([candidate({ probeKey: 'profile:notes' })]), {
      timeoutMs: 5_000,
      connector: (config) => {
        const session = new FakeSession(config, {
          // 完全忽略 signal：只有 cancel() 才能让连接 promise 结束。
          connect: async () => {
            await negotiation.promise
          },
          cancel: () => {
            negotiation.reject(new Error('transport closed during negotiation'))
          },
        })
        sessions.push(session)
        return session
      },
    })
    const controller = new AbortController()
    const pending = service.probe('profile:notes', { signal: controller.signal })
    await until(() => sessions.length === 1, '连接已建立')
    const started = Date.now()
    controller.abort()
    expect(await pending).toMatchObject({ ok: false, code: 'cancelled' })
    expect(Date.now() - started).toBeLessThan(200)
    expect(sessions[0]!.cancelCalls).toBe(1)
    await service.dispose()
  })

  it('connect 永不 settle 且完全没有 cancel：外层 race 仍让探测在预算内返回', async () => {
    const service = new McpProbeService(collectingReader([candidate({ probeKey: 'profile:notes' })]), {
      timeoutMs: 40,
      closeTimeoutMs: 20,
      connector: (config) => {
        const session = new FakeSession(config, { connect: async () => never() })
        // 模拟旧替身/旧 SDK：没有 cancel。
        session.cancel = undefined as unknown as ProbeSession['cancel']
        return session
      },
    })
    const started = Date.now()
    const result = await service.probe('profile:notes')
    expect(result).toMatchObject({ ok: false, code: 'timeout' })
    expect(Date.now() - started).toBeLessThan(600)
    await service.dispose()
  })

  it('SDK 超时后才返回成功：超过预算不得返回 success', async () => {
    let clock = 1_000
    const service = new McpProbeService(collectingReader([candidate({ probeKey: 'profile:notes' })]), {
      timeoutMs: 10_000,
      now: () => clock,
      connector: (config) =>
        new FakeSession(config, {
          // 忽略 signal，并在 deadline 之后才 resolve。
          listTools: async () => {
            clock += 20_000
            return { supported: true, names: ['late-tool'] }
          },
        }),
    })
    const result = await service.probe('profile:notes')
    expect(result).toMatchObject({ ok: false, code: 'timeout', stage: 'timeout' })
    expect(JSON.stringify(result)).not.toContain('late-tool')
    await service.dispose()
  })

  it('connect 在 deadline 之后才成功同样不得返回 success', async () => {
    let clock = 5_000
    const service = new McpProbeService(collectingReader([candidate({ probeKey: 'profile:notes' })]), {
      timeoutMs: 10_000,
      now: () => clock,
      connector: (config) =>
        new FakeSession(config, {
          connect: async () => {
            clock += 11_000
          },
        }),
    })
    expect(await service.probe('profile:notes')).toMatchObject({ ok: false, code: 'timeout' })
    await service.dispose()
  })
})

// ---------------------------------------------------------------------------
// dispose 并发
// ---------------------------------------------------------------------------

describe('dispose 并发语义', () => {
  it('并发 dispose 返回同一个 Promise，且不早于在途探测 settle', async () => {
    const sessions: FakeSession[] = []
    const service = new McpProbeService(collectingReader([candidate({ probeKey: 'profile:notes' })]), {
      timeoutMs: 5_000,
      connector: (config) => {
        const session = new FakeSession(config, { connect: async (options) => waitAbort(options.signal) })
        sessions.push(session)
        return session
      },
    })
    const order: string[] = []
    const pending = service.probe('profile:notes')
    void pending.then(() => order.push('probe'))
    await until(() => sessions.length === 1, '连接已建立')

    const first = service.dispose()
    const second = service.dispose()
    expect(second).toBe(first)
    void first.then(() => order.push('dispose'))
    await first
    expect(await pending).toMatchObject({ code: 'cancelled' })
    await second

    // 完成后再次 dispose 仍返回同一个 Promise（幂等、不提前返回）。
    expect(service.dispose()).toBe(first)
    expect(order).toEqual(['probe', 'dispose'])
    expect(await service.probe('profile:notes')).toMatchObject({ code: 'unavailable' })
  })
})

// ---------------------------------------------------------------------------
// 安全：敏感字段只在可探测候选上求值
// ---------------------------------------------------------------------------

describe('敏感字段只在可探测候选上规范化', () => {
  function trackedConfig(): { config: Record<string, unknown>; touched: string[] } {
    const touched: string[] = []
    const config = new Proxy(
      {} as Record<string, unknown>,
      {
        get: (_target, key) => {
          touched.push(`get:${String(key)}`)
          return undefined
        },
        ownKeys: () => {
          touched.push('ownKeys')
          return []
        },
        getOwnPropertyDescriptor: () => {
          touched.push('getOwnPropertyDescriptor')
          return undefined
        },
      },
    )
    return { config, touched }
  }

  it('disabled 的 profile 条目不读取其配置对象（env/headers/command/url 不求值）', async () => {
    const tracked = trackedConfig()
    const reader = new McpProbeConfigReader({
      loader: {
        entries: () => [
          {
            id: 'mcp.off',
            disabled: true,
            options: { id: 'mcp.off', name: MCP_MODULE, config: tracked.config },
          },
        ],
      },
    })
    const collection = await reader.collect()
    expect(collection.candidates).toHaveLength(1)
    expect(collection.candidates[0]).toMatchObject({
      probeAvailable: false,
      probeUnavailableReason: 'disabled',
    })
    expect(collection.candidates[0]!.config).toBeUndefined()
    expect(tracked.touched).toEqual([])
  })

  it('preset 的 broken / conditional 条目跳过配置规范化（不猜 URL/凭据）', async () => {
    const content = `- id: preset.mcp
  name: '${MCP_MODULE}'
  config:
    serverName: notes
    transport: streamable-http
    url: !!js ctx.privateUrl
    headers:
      Authorization: !!js ctx.privateToken
`
    const reader = new McpProbeConfigReader({
      presets: {
        serviceFor: () => undefined,
        compositionInventory: async () => [
          { id: 'broken', broken: 'combine failed', rows: [{ entryId: 'preset.mcp', moduleName: MCP_MODULE, enabled: true }] },
          { id: 'conditional', rows: [{ entryId: 'preset.mcp', moduleName: MCP_MODULE, enabled: 'conditional', condition: 'ctx.flag' }] },
        ],
        readDocument: async (id: string) => ({ agentPreset: id, content }),
      },
    })
    const collection = await reader.collect()
    expect(collection.candidates.map((item) => [item.probeUnavailableReason, item.config])).toEqual([
      ['probe_unavailable', undefined],
      ['conditional', undefined],
    ])
  })

  it('可探测候选仍会被规范化（对照：证明上面的跳过不是假阴性）', async () => {
    const reader = new McpProbeConfigReader({
      loader: {
        entries: () => [
          {
            id: 'mcp.on',
            disabled: false,
            options: {
              id: 'mcp.on',
              name: MCP_MODULE,
              config: {
                serverName: 'on',
                transport: 'stdio',
                command: '/bin/true',
                env: { API_TOKEN: 'secret' },
              },
            },
          },
        ],
      },
    })
    const collection = await reader.collect()
    expect(collection.candidates[0]!.probeAvailable).toBe(true)
    expect(collection.candidates[0]!.config).toMatchObject({ transport: 'stdio', command: '/bin/true' })
  })

  it('readDocument 全失败时 presets 不声明为可读；部分成功才是 true', async () => {
    const rows = [{ entryId: 'preset.mcp', moduleName: MCP_MODULE, enabled: true }]
    const failing = new McpProbeConfigReader({
      presets: {
        serviceFor: () => undefined,
        compositionInventory: async () => [{ id: 'ptc', rows }],
        readDocument: async () => {
          throw new Error('agent-preset/not-found')
        },
      },
    })
    const failed = await failing.collect()
    expect(failed.presets).toBe(false)
    expect(failed.available).toBe(false)

    const partial = new McpProbeConfigReader({
      presets: {
        serviceFor: () => undefined,
        compositionInventory: async () => [
          { id: 'ok', rows },
          { id: 'missing', rows },
        ],
        readDocument: async (id: string) => {
          if (id !== 'ok') throw new Error('agent-preset/not-found')
          return {
            agentPreset: id,
            content: `- id: preset.mcp\n  name: '${MCP_MODULE}'\n  config:\n    serverName: notes\n    transport: streamable-http\n    url: 'https://mcp.invalid/mcp'\n`,
          }
        },
      },
    })
    const succeeded = await partial.collect()
    expect(succeeded.presets).toBe(true)
    expect(succeeded.candidates.map((item) => item.probeAvailable)).toEqual([true, false])
  })
})

// ---------------------------------------------------------------------------
// P1-5：stdio 代理覆盖层（对齐 dsh-subprocess / dsh-http-proxy）
// ---------------------------------------------------------------------------

describe('stdio 子环境代理覆盖层（复刻 proxyEnvironmentForChild）', () => {
  const parent: NodeJS.ProcessEnv = {
    PATH: '/usr/bin',
    HOME: '/home/user',
    API_KEY: 'parent-key',
    DSH_SESSION: 'internal',
    http_proxy: 'http://proxy.local:8080',
    HTTPS_PROXY: 'http://secure-proxy.local:8443',
    no_proxy: 'internal.local',
  }

  it('有可用 http(s) 代理：补 NODE_USE_ENV_PROXY 并规范化两种大小写', () => {
    const env = buildScrubbedChildEnv({}, parent)
    expect(env.NODE_USE_ENV_PROXY).toBe('1')
    expect(env.http_proxy).toBe('http://proxy.local:8080')
    expect(env.HTTP_PROXY).toBe('http://proxy.local:8080')
    expect(env.https_proxy).toBe('http://secure-proxy.local:8443')
    expect(env.HTTPS_PROXY).toBe('http://secure-proxy.local:8443')
    expect(env.no_proxy).toBe('internal.local')
    expect(env.NO_PROXY).toBe('internal.local')
    // 剔除规则不变。
    expect(env.API_KEY).toBeUndefined()
    expect(env.DSH_SESSION).toBeUndefined()
    expect(env.PATH).toBe('/usr/bin')
  })

  it('没有代理时不加标志、不写代理名', () => {
    const overlay = proxyEnvironmentForChild({ PATH: '/usr/bin' })
    expect(overlay).toEqual({})
    const env = buildScrubbedChildEnv({}, { PATH: '/usr/bin' })
    expect(env.NODE_USE_ENV_PROXY).toBeUndefined()
    expect(env.http_proxy).toBeUndefined()
  })

  it('SOCKS/畸形代理 URL：不发 NODE_USE_ENV_PROXY（否则 Node 子进程启动即退出）', () => {
    for (const value of ['socks5://127.0.0.1:1080', 'not a url', 'ftp://proxy.local:21']) {
      const env = buildScrubbedChildEnv({}, { https_proxy: value })
      expect(env.NODE_USE_ENV_PROXY).toBeUndefined()
      // 值仍保留给 curl 之类的非 Node 子进程（与官方一致）。
      expect(env.https_proxy).toBe(value)
    }
  })

  it('配置显式 env 在剔除与覆盖层之后合并（含敏感名与代理覆盖）', () => {
    const env = buildScrubbedChildEnv({ HTTP_PROXY: 'http://override.local:1', API_TOKEN: 'explicit' }, parent)
    expect(env.HTTP_PROXY).toBe('http://override.local:1')
    expect(env.API_TOKEN).toBe('explicit')
  })

  it('覆盖层里的 undefined 表示从子环境移除该名', () => {
    const env = buildScrubbedChildEnv({}, parent, { HTTP_PROXY: undefined, http_proxy: 'http://other.local:2' })
    expect(env.HTTP_PROXY).toBeUndefined()
    expect(env.http_proxy).toBe('http://other.local:2')
  })
})

// ---------------------------------------------------------------------------
// P1-6：托管路径复用统一限制
// ---------------------------------------------------------------------------

describe('托管探测复用统一限制（10s / 并发 2 / 取消 / dispose）', () => {
  function managerOf(probe: (server: string) => Promise<McpProbeOutcomeFace>): {
    list: () => Promise<readonly never[]>
    probe: (server: string) => Promise<McpProbeOutcomeFace>
  } {
    return { list: async () => [], probe }
  }

  it('托管探测在预算内返回 timeout（底层不可取消，本地响应不等它）', async () => {
    const catalog = new McpCatalog({
      manager: managerOf(() => never()),
      probeRuntime: { timeoutMs: 30 },
    })
    const started = Date.now()
    const result = await catalog.probe('notes')
    expect(result).toMatchObject({ ok: false, code: 'timeout', stage: 'timeout' })
    expect(Date.now() - started).toBeLessThan(400)
    await catalog.disposeProbes()
  })

  it('托管探测遵守全局并发上限 2', async () => {
    let active = 0
    let peak = 0
    const releases: (() => void)[] = []
    const catalog = new McpCatalog({
      manager: managerOf(async (server) => {
        active += 1
        peak = Math.max(peak, active)
        await new Promise<void>((resolve) => releases.push(resolve))
        active -= 1
        return { ok: true, toolNames: [server] }
      }),
      probeRuntime: { timeoutMs: 5_000 },
    })
    const probes = ['a', 'b', 'c'].map((name) => catalog.probeByKey(`managed:${name}`))
    await until(() => active === 2, '前两个探测已开始')
    expect(peak).toBe(2)
    releases.shift()?.()
    await until(() => releases.length >= 2, '第三个探测已补位')
    while (releases.length > 0) releases.shift()?.()
    const results = await Promise.all(probes)
    expect(results.every((result) => result.ok)).toBe(true)
    expect(peak).toBe(2)
    expect(results.map((result) => (result.ok ? result.toolNames[0] : ''))).toEqual(['a', 'b', 'c'])
    await catalog.disposeProbes()
  })

  it('托管探测的调用者取消立即返回 cancelled', async () => {
    const catalog = new McpCatalog({
      manager: managerOf(() => never()),
      probeRuntime: { timeoutMs: 5_000 },
    })
    const controller = new AbortController()
    const pending = catalog.probe('notes', { signal: controller.signal })
    await tick()
    const started = Date.now()
    controller.abort()
    expect(await pending).toMatchObject({ ok: false, code: 'cancelled' })
    expect(Date.now() - started).toBeLessThan(200)
    await catalog.disposeProbes()
  })

  it('dispose 中止在途托管探测（返回同一个 Promise）', async () => {
    const catalog = new McpCatalog({
      manager: managerOf(() => never()),
      probeRuntime: { timeoutMs: 5_000 },
    })
    const pending = catalog.probe('notes')
    await tick()
    const first = catalog.disposeProbes()
    const second = catalog.disposeProbes()
    expect(second).toBe(first)
    expect(await pending).toMatchObject({ code: 'cancelled' })
    await first
  })

  it('托管探测的迟到成功不得越过 deadline（超预算不返回 ok:true）', async () => {
    let clock = 1_000
    const catalog = new McpCatalog({
      manager: managerOf(async () => {
        clock += 20_000
        return { ok: true, toolNames: ['late'] }
      }),
      probeRuntime: { timeoutMs: 10_000, now: () => clock },
    })
    expect(await catalog.probe('notes')).toMatchObject({ ok: false, code: 'timeout' })
    await catalog.disposeProbes()
  })
})

// ---------------------------------------------------------------------------
// 安全边界：探测 DTO 不含配置，原始错误不外泄
// ---------------------------------------------------------------------------

describe('探测 DTO 安全边界', () => {
  it('响应不含配置字段，连接错误文本不透出', async () => {
    const service = new McpProbeService(
      collectingReader([
        candidate({
          probeKey: 'profile:stdio',
          config: {
            transport: 'stdio',
            serverName: 'stdio',
            command: '/private/bin/secret-server',
            args: ['--token', 'arg-secret'],
            env: { API_TOKEN: 'env-secret' },
          },
        }),
      ]),
      {
        connector: () => {
          throw new Error('spawn /private/bin/secret-server failed with env-secret')
        },
      },
    )
    const result = await service.probe('profile:stdio')
    expect(result).toMatchObject({ ok: false, code: 'connect' })
    const wire = JSON.stringify(result)
    for (const secret of ['/private/bin/secret-server', 'env-secret', 'arg-secret', 'command', 'headers']) {
      expect(wire).not.toContain(secret)
    }
    await service.dispose()
  })
})
