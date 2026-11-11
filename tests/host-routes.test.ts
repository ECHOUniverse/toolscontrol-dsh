/**
 * Host 路由表测试：`/toolscontrol` 前缀下的处理器以普通 `(req, res)` 调用
 * 驱动（官方自定义路由契约）。
 *
 * 安全契约与官方示例一致：
 * - 仅 `health` 公开（只含插件标识，不含任何数据）；
 * - 其余路由先过 `connection.requestRejection` 信任门（缺失 → 503 关闭
 *   保护面；未认证 401；不可信 403），再过方法门、媒体类型门、参数校验；
 * - probe 为显式 POST，只按名称探测。
 */
import { describe, expect, it } from 'vitest'
import { ROUTE_BASE, ROUTES } from '../src/shared/protocol.ts'
import { registerRoutes } from '../src/host/routes.ts'
import { McpCatalog } from '../src/host/mcp.ts'
import { SkillCatalog } from '../src/host/skills.ts'
import { OverviewService } from '../src/host/inventory.ts'
import type { ConnectionFace, PluginInventoryEntryFace, SkillSummaryFace, WebServerFace } from '../src/host/services.ts'

// ---------------------------------------------------------------------------
// 测试装置（对齐官方契约的最小伪造）
// ---------------------------------------------------------------------------

/** node:http 式响应收集器。 */
class MockResponse {
  statusCode = 200
  headers = new Map<string, string | string[]>()
  chunks: (string | Buffer)[] = []
  writableEnded = false
  private listeners = new Map<string, Set<() => void>>()

  on(event: string, listener: () => void): void {
    const set = this.listeners.get(event) ?? new Set()
    set.add(listener)
    this.listeners.set(event, set)
  }

  once(event: string, listener: () => void): void {
    const wrapped = (): void => {
      this.off(event, wrapped)
      listener()
    }
    this.on(event, wrapped)
  }

  off(event: string, listener: () => void): void {
    this.listeners.get(event)?.delete(listener)
  }

  emit(event: string): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) listener()
  }

  setHeader(name: string, value: string | string[]): void {
    this.headers.set(String(name).toLowerCase(), value)
  }

  getHeader(name: string): string | string[] | undefined {
    return this.headers.get(String(name).toLowerCase())
  }

  write(chunk: string | Buffer): boolean {
    this.chunks.push(chunk)
    return true
  }

  end(body?: string | Buffer): void {
    if (body !== undefined) this.chunks.push(body)
    this.writableEnded = true
  }

  get body(): string {
    return Buffer.concat(this.chunks.map((chunk) => (Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))).toString('utf8')
  }

  json(): any {
    return JSON.parse(this.body)
  }

  get contentType(): string {
    return String(this.headers.get('content-type') ?? '')
  }

  get status(): number {
    return this.statusCode
  }
}

interface RequestOptions {
  method?: string
  headers?: Record<string, string>
  body?: string
}

function mockRequest(url: string, options: RequestOptions = {}): any {
  const chunks = options.body !== undefined ? [Buffer.from(options.body)] : []
  return {
    url,
    method: options.method ?? 'GET',
    headers: { host: '127.0.0.1:3080', ...options.headers },
    resume(): void {},
    async *[Symbol.asyncIterator](): Generator<Buffer> {
      for (const chunk of chunks) yield chunk
    },
  }
}

/** 官方信任门替身：loopback Host、cross-site 拒绝、同权 Origin、认证检查。 */
function fakeConnection(options: { authenticated?: boolean } = {}): ConnectionFace {
  return {
    requestRejection(request: { headers: Record<string, string | string[] | undefined> }): 401 | 403 | undefined {
      const headers = request.headers
      const host = headers.host
      if (typeof host !== 'string') return 403
      const hostname = host.split(':')[0] ?? ''
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(hostname)) return 403
      if (String(headers['sec-fetch-site'] ?? '') === 'cross-site') return 403
      const origin = headers.origin
      if (origin !== undefined) {
        try {
          if (new URL(String(origin)).host !== host) return 403
        } catch {
          return 403
        }
      }
      return (options.authenticated ?? true) ? undefined : 401
    },
  }
}

interface StubWebServer extends WebServerFace {
  routes: { kind: string; path: string; handler: (req: any, res: any) => Promise<void> | void }[]
}

function stubWebServer(): StubWebServer {
  const routes: StubWebServer['routes'] = []
  return {
    routes,
    register(route: { kind: 'exact' | 'prefix'; path: string; handler: (req: any, res: any) => Promise<void> | void }) {
      routes.push(route)
      return () => {
        const index = routes.indexOf(route)
        if (index >= 0) routes.splice(index, 1)
      }
    },
  }
}

// ---------------------------------------------------------------------------
// 被测装配
// ---------------------------------------------------------------------------

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

function mount(options: { authenticated?: boolean; withConnection?: boolean } = {}) {
  const overview = new OverviewService(
    new McpCatalog({ inventory: { list: async () => ({ entries: [INVENTORY_ENTRY] }) } }),
    new SkillCatalog({ registry: { list: async () => [SKILL] } }),
  )
  const webServer = stubWebServer()
  const connection = options.withConnection === false ? undefined : fakeConnection({ authenticated: options.authenticated ?? true })
  registerRoutes(webServer, { overview, ...(connection !== undefined ? { connection } : {}) })
  const handler = webServer.routes[0]!.handler
  const call = async (url: string, reqOptions: RequestOptions = {}): Promise<MockResponse> => {
    const res = new MockResponse()
    await handler(mockRequest(url, reqOptions), res)
    return res
  }
  return { call, webServer }
}

// ---------------------------------------------------------------------------
// 用例
// ---------------------------------------------------------------------------

describe('GET /toolscontrol/health（唯一最小公开路由）', () => {
  it('无信任门也只答插件标识，不携带任何数据', async () => {
    const { call } = mount({ withConnection: false })
    const res = await call(ROUTES.health)
    expect(res.status).toBe(200)
    expect(res.json()).toEqual({ ok: true, plugin: '@hanxu131/toolscontrol-dsh', version: '0.1.0' })
  })

  it('非 GET → 405 + Allow', async () => {
    const { call } = mount()
    const res = await call(ROUTES.health, { method: 'POST' })
    expect(res.status).toBe(405)
    expect(res.getHeader('allow')).toBe('GET')
  })
})

describe('保护路由的官方信任门', () => {
  it('connection 服务缺失 → 503（保护面整体关闭）', async () => {
    const { call } = mount({ withConnection: false })
    const res = await call(ROUTES.overview)
    expect(res.status).toBe(503)
  })

  it('未认证 → 401', async () => {
    const { call } = mount({ authenticated: false })
    expect((await call(ROUTES.overview)).status).toBe(401)
    expect((await call(ROUTES.probe, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(401)
  })

  it('cross-site → 403', async () => {
    const { call } = mount()
    const res = await call(ROUTES.overview, { headers: { 'sec-fetch-site': 'cross-site' } })
    expect(res.status).toBe(403)
  })
})

describe('GET /toolscontrol/overview（只读总览快照）', () => {
  it('认证后返回 MCP + Skills 快照', async () => {
    const { call } = mount()
    const res = await call(ROUTES.overview)
    expect(res.status).toBe(200)
    expect(res.contentType).toContain('application/json')
    const body = res.json()
    expect(body.plugin).toBe('@hanxu131/toolscontrol-dsh')
    expect(body.mcp.mode).toBe('config')
    expect(body.mcp.servers).toEqual([
      {
        name: 'mcp.notes',
        enabled: true,
        configured: true,
        status: 'unknown',
        source: 'unknown',
        scope: 'profile',
        probeKey: 'profile:mcp.notes',
        probeAvailable: false,
        probeUnavailableReason: 'probe_unavailable',
      },
    ])
    expect(body.skills.skills.map((entry: { name: string }) => entry.name)).toEqual(['demo'])
    expect(body.skills.cwd).toBeNull()
  })

  it('cwd 查询参数进入 Skills 快照作为项目级发现上下文', async () => {
    const { call } = mount()
    const res = await call(`${ROUTES.overview}?cwd=%2Fworkspace%2Fdemo`)
    expect(res.status).toBe(200)
    expect(res.json().skills.cwd).toBe('/workspace/demo')
  })

  it('cwd 非绝对路径 → 400 invalid_input', async () => {
    const { call } = mount()
    const res = await call(`${ROUTES.overview}?cwd=relative%2Fpath`)
    expect(res.status).toBe(400)
    expect(res.json().error.code).toBe('invalid_input')
  })

  it('cwd 含 NUL → 400', async () => {
    const { call } = mount()
    const res = await call(`${ROUTES.overview}?cwd=${encodeURIComponent('/tmp\0/evil')}`)
    expect(res.status).toBe(400)
  })

  it('POST → 405 + Allow', async () => {
    const { call } = mount()
    const res = await call(ROUTES.overview, { method: 'POST' })
    expect(res.status).toBe(405)
    expect(res.getHeader('allow')).toBe('GET')
  })

  it('配置收集永久挂起：overview 仍按时返回，探测降级但服务器列表保留', async () => {
    const overview = new OverviewService(
      new McpCatalog({
        inventory: { list: async () => ({ entries: [INVENTORY_ENTRY] }) },
        probeReader: { collect: () => new Promise(() => undefined) },
        probeRuntime: { configTimeoutMs: 30 },
      }),
      new SkillCatalog({ registry: { list: async () => [SKILL] } }),
    )
    const webServer = stubWebServer()
    registerRoutes(webServer, { overview, connection: fakeConnection() })
    const res = new MockResponse()
    const started = Date.now()
    await webServer.routes[0]!.handler(mockRequest(ROUTES.overview), res)
    expect(Date.now() - started).toBeLessThan(1_000)
    expect(res.status).toBe(200)
    const body = res.json()
    expect(body.mcp.servers.map((entry: { name: string }) => entry.name)).toEqual(['mcp.notes'])
    expect(body.mcp.probe.available).toBe(false)
    expect(body.skills.skills.map((entry: { name: string }) => entry.name)).toEqual(['demo'])
  })
})

describe('POST /toolscontrol/mcp/probe（显式工具探测）', () => {
  it('按旧版 server 名称探测：rc.5 无管理服务时返回业务结果 unavailable', async () => {
    const { call } = mount()
    const res = await call(ROUTES.probe, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ server: 'mcp.notes' }),
    })
    expect(res.status).toBe(200)
    expect(res.json()).toMatchObject({
      ok: false,
      code: 'unavailable',
      stage: 'unavailable',
      probeKey: 'managed:mcp.notes',
      message: expect.stringContaining('MCP 管理服务'),
    })
  })

  it('按 probeKey 单条探测：200 承载业务结果，并传递可中断的 AbortSignal', async () => {
    const webServer = stubWebServer()
    let seenKey = ''
    let seenSignal: AbortSignal | undefined
    const overview = {
      snapshot: async () => { throw new Error('not used') },
      probe: async () => { throw new Error('not used') },
      probeByKey: async (probeKey: string, options: { signal?: AbortSignal }) => {
        seenKey = probeKey
        seenSignal = options.signal
        return new Promise((resolve) => {
          options.signal?.addEventListener('abort', () => {
            resolve({
              ok: false as const,
              probeKey,
              stage: 'cancelled' as const,
              code: 'cancelled' as const,
              message: '探测已取消',
              durationMs: 0,
            })
          })
        })
      },
    }
    registerRoutes(webServer, { overview: overview as unknown as OverviewService, connection: fakeConnection() })
    const res = new MockResponse()
    const running = webServer.routes[0]!.handler(
      mockRequest(ROUTES.probe, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ probeKey: 'profile:mcp.notes' }),
      }),
      res,
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(seenKey).toBe('profile:mcp.notes')
    expect(seenSignal?.aborted).toBe(false)
    res.emit('close')
    await running
    expect(seenSignal?.aborted).toBe(true)
    expect(res.status).toBe(200)
    expect(res.json()).toMatchObject({ ok: false, code: 'cancelled' })
  })

  it('请求体读取期间断开：不发起探测、不向已关闭的响应写入', async () => {
    const webServer = stubWebServer()
    let probed = 0
    const overview = {
      snapshot: async () => {
        throw new Error('not used')
      },
      probe: async () => {
        probed += 1
        throw new Error('not used')
      },
      probeByKey: async () => {
        probed += 1
        throw new Error('not used')
      },
    }
    registerRoutes(webServer, { overview: overview as unknown as OverviewService, connection: fakeConnection() })
    const res = new MockResponse()
    // body 的异步迭代期间客户端断开：监听必须在读取请求体之前就已建立。
    const req: any = {
      url: ROUTES.probe,
      method: 'POST',
      headers: { host: '127.0.0.1:3080', 'content-type': 'application/json' },
      resume(): void {},
      async *[Symbol.asyncIterator](): AsyncGenerator<Buffer> {
        res.emit('close')
        yield Buffer.from(JSON.stringify({ probeKey: 'profile:mcp.notes' }))
      },
    }
    await webServer.routes[0]!.handler(req, res)
    expect(probed).toBe(0)
    expect(res.writableEnded).toBe(false)
    expect(res.body).toBe('')
  })

  it('正常完成的响应不会被误判为断开（signal 未 abort）', async () => {
    const webServer = stubWebServer()
    const seen: AbortSignal[] = []
    const overview = {
      snapshot: async () => {
        throw new Error('not used')
      },
      probe: async () => {
        throw new Error('not used')
      },
      probeByKey: async (probeKey: string, options: { signal?: AbortSignal }) => {
        if (options.signal !== undefined) seen.push(options.signal)
        return {
          ok: true as const,
          probeKey,
          scope: 'profile' as const,
          entryId: 'mcp.notes',
          probedAt: 1,
          durationMs: 1,
          toolNames: ['t'],
          toolCount: 1,
        }
      },
    }
    registerRoutes(webServer, { overview: overview as unknown as OverviewService, connection: fakeConnection() })
    const res = new MockResponse()
    await webServer.routes[0]!.handler(
      mockRequest(ROUTES.probe, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ probeKey: 'profile:mcp.notes' }),
      }),
      res,
    )
    expect(res.status).toBe(200)
    expect(res.json()).toMatchObject({ ok: true, toolNames: ['t'] })
    expect(seen).toHaveLength(1)
    expect(seen[0]!.aborted).toBe(false)
  })

  it('probeKey 超长 → 400；probeKey 与 server 都缺失 → 400', async () => {
    const { call } = mount()
    const tooLong = await call(ROUTES.probe, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ probeKey: `profile:${'x'.repeat(600)}` }),
    })
    expect(tooLong.status).toBe(400)
    expect(tooLong.json().error.code).toBe('invalid_input')
    const missing = await call(ROUTES.probe, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    expect(missing.status).toBe(400)
  })

  it('缺 server 字段 → 400', async () => {
    const { call } = mount()
    const res = await call(ROUTES.probe, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    expect(res.status).toBe(400)
    expect(res.json().error.code).toBe('invalid_input')
  })

  it('媒体类型非 JSON → 415；GET → 405', async () => {
    const { call } = mount()
    expect((await call(ROUTES.probe, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' })).status).toBe(415)
    expect((await call(ROUTES.probe)).status).toBe(405)
  })
})

describe('未知路径与方法', () => {
  it('未声明的路径 → 404 错误包络', async () => {
    const { call } = mount()
    const res = await call(`${ROUTE_BASE}/nope`)
    expect(res.status).toBe(404)
    expect(res.json().error.code).toBe('not_found')
  })
})

describe('畸形请求与内部错误包络', () => {
  it('畸形 req.url → 400 invalid_input JSON 包络，处理器不抛出', async () => {
    const { call } = mount()
    const res = await call('http://[::1')
    expect(res.status).toBe(400)
    expect(res.json().error.code).toBe('invalid_input')
    expect(res.contentType).toContain('application/json')
  })

  it('处理器内部错误 → 500 通用安全 message，内部字符串不泄露', async () => {
    const webServer = stubWebServer()
    const overview = {
      snapshot: async () => { throw new Error('secret-internal-database-location') },
      probe: async () => { throw new Error('secret-internal-probe') },
    }
    registerRoutes(webServer, { overview, connection: fakeConnection() })
    const handler = webServer.routes[0]!.handler
    const res = new MockResponse()
    await handler(mockRequest(ROUTES.overview), res)
    expect(res.status).toBe(500)
    expect(res.json().error.code).toBe('internal')
    expect(res.json().error.message).toBe('Internal server error')
    expect(res.body).not.toContain('secret-internal')
  })
})
