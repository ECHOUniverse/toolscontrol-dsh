/**
 * 回归：Skills 必须按「当前会话」的 preset scope 读取官方注册表。
 *
 * 真实故障（Desktop 0.2.1-rc.5 组合）：Host 端 `SkillCatalog` 调
 * `ctx.skills.list({cwd})` 时没有传 `scope`，而当前 DSH 的
 * skill-filesystem 注册在会话 preset scope，宿主全局层只有 dsh-badge，
 * 于是总览只显示 1 条插件 Skill，而会话实际有 95 条。
 *
 * 官方 `sessionSkillCatalog.list` 的链路是：
 *   agents.get(sessionId) → live Agent（同时作为 scope）
 *   agentPresets.serviceFor(live, 'skills') ?? ctx.skills
 *   registry.list({ cwd, scope: live })
 *
 * 本测试从 HTTP 路由（真实调用链）驱动，断言 registry 实际收到的参数，
 * 而不是只测 SkillCatalog 的单元行为。
 */
import { afterAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ROUTES } from '../src/shared/protocol.ts'
import { registerRoutes } from '../src/host/routes.ts'
import { McpCatalog } from '../src/host/mcp.ts'
import { SkillCatalog } from '../src/host/skills.ts'
import { OverviewService } from '../src/host/inventory.ts'
import type {
  AgentFace,
  AgentPresetsFace,
  AgentsFace,
  ConnectionFace,
  SkillSummaryFace,
  SkillsRegistryFace,
  WebServerFace,
} from '../src/host/services.ts'

// ---------------------------------------------------------------------------
// 扫描根隔离：本文件只验证 registry 的会话 scope，不让真实用户目录参与。
// ---------------------------------------------------------------------------

const EMPTY_DSH_HOME = mkdtempSync(join(tmpdir(), 'toolscontrol-session-dsh-'))
const EMPTY_AGENTS_HOME = mkdtempSync(join(tmpdir(), 'toolscontrol-session-agents-'))

afterAll(() => {
  rmSync(EMPTY_DSH_HOME, { recursive: true, force: true })
  rmSync(EMPTY_AGENTS_HOME, { recursive: true, force: true })
})

function roots(): { dshHome: string; agentsHome: string } {
  return { dshHome: EMPTY_DSH_HOME, agentsHome: EMPTY_AGENTS_HOME }
}

// ---------------------------------------------------------------------------
// 最小 HTTP 装置（与 host-routes.test.ts 同形）
// ---------------------------------------------------------------------------

class MockResponse {
  statusCode = 200
  headers = new Map<string, string | string[]>()
  chunks: (string | Buffer)[] = []
  writableEnded = false

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

  get status(): number {
    return this.statusCode
  }
}

function mockRequest(url: string): any {
  return {
    url,
    method: 'GET',
    headers: { host: '127.0.0.1:3080' },
    resume(): void {},
    async *[Symbol.asyncIterator](): Generator<Buffer> {},
  }
}

const ALLOW_ALL: ConnectionFace = { requestRejection: () => undefined }

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

function summary(name: string): SkillSummaryFace {
  return {
    name,
    description: `${name} description`,
    invocation: { modelInvocable: true, userInvocable: true },
    source: 'user-dsh',
    provider: 'filesystem',
  }
}

/** 记录每次 `list(options)` 的注册表替身。 */
function registryOf(name: string, calls: unknown[]): SkillsRegistryFace {
  return {
    list: async (options) => {
      calls.push(options)
      return [summary(name)]
    },
  }
}

interface MountDeps {
  registry?: SkillsRegistryFace
  agents: AgentsFace
  presets?: AgentPresetsFace
}

function mount(deps: MountDeps): (url: string) => Promise<MockResponse> {
  const overview = new OverviewService(
    new McpCatalog({ inventory: { list: async () => ({ entries: [] }) } }),
    new SkillCatalog({
      registry: deps.registry,
      agents: deps.agents,
      ...(deps.presets !== undefined ? { presets: deps.presets } : {}),
      roots: roots(),
    }),
  )
  const webServer = stubWebServer()
  registerRoutes(webServer, { overview, connection: ALLOW_ALL })
  const handler = webServer.routes[0]!.handler
  return async (url: string): Promise<MockResponse> => {
    const res = new MockResponse()
    await handler(mockRequest(url), res)
    return res
  }
}

// ---------------------------------------------------------------------------
// 用例
// ---------------------------------------------------------------------------

describe('Skills 会话 scope（真实路由调用链）', () => {
  it('live Agent 存在时，经该会话 preset 的 skills 注册表读取，并传 scope=live', async () => {
    const hostCalls: unknown[] = []
    const presetCalls: unknown[] = []
    const serviceForCalls: [AgentFace, string][] = []
    const live: AgentFace = { id: 'session-live' }
    const hostRegistry = registryOf('host-only', hostCalls)
    const presetRegistry = registryOf('session-skill', presetCalls)
    const call = mount({
      registry: hostRegistry,
      agents: { get: (id) => (id === live.id ? live : undefined) },
      presets: {
        serviceFor: (agent, name) => {
          serviceForCalls.push([agent, name])
          return agent === live && name === 'skills' ? presetRegistry : undefined
        },
      },
    })

    const res = await call(`${ROUTES.overview}?cwd=%2Fworkspace%2Fdemo&sessionId=${live.id}`)

    expect(res.status).toBe(200)
    expect(res.json().skills.skills.map((entry: { name: string }) => entry.name)).toEqual(['session-skill'])
    // 真实故障的核心：scope 必须是 live Agent 对象，且 cwd 同时透传。
    expect(presetCalls).toEqual([{ cwd: '/workspace/demo', scope: live }])
    expect(serviceForCalls).toEqual([[live, 'skills']])
    // 宿主全局 registry 不得被当作会话结果来源。
    expect(hostCalls).toEqual([])
    expect(res.json().skills.warnings.join('\n')).not.toMatch(/没有运行中的 Agent/)
  })

  it('宿主 skills registry 缺失但 live 会话有 preset skills 服务时，仍读取 preset（官方 scoped ?? host）', async () => {
    const presetCalls: unknown[] = []
    const live: AgentFace = { id: 'session-live' }
    const call = mount({
      // 无宿主 registry：官方 `agentPresets.serviceFor(live,'skills') ?? ctx.skills`
      // 允许只靠 preset 的 skills registry。
      agents: { get: () => live },
      presets: { serviceFor: () => registryOf('preset-only', presetCalls) },
    })

    const res = await call(`${ROUTES.overview}?cwd=%2Fworkspace%2Fdemo&sessionId=${live.id}`)

    expect(res.status).toBe(200)
    expect(res.json().skills.skills.map((entry: { name: string }) => entry.name)).toEqual(['preset-only'])
    expect(presetCalls).toEqual([{ cwd: '/workspace/demo', scope: live }])
    expect(res.json().skills.warnings.join('\n')).not.toMatch(/skills 服务不可用/)
  })

  it('宿主 registry 与 preset 服务都不可用 → 明确不可用 warning，不抛错', async () => {
    const live: AgentFace = { id: 'session-live' }
    const call = mount({
      agents: { get: () => live },
      presets: { serviceFor: () => undefined },
    })

    const res = await call(`${ROUTES.overview}?sessionId=${live.id}`)

    expect(res.status).toBe(200)
    expect(res.json().skills.skills).toEqual([])
    expect(res.json().skills.warnings.join('\n')).toMatch(/skills 服务不可用/)
  })

  it('preset 专属 skills 服务缺失时，仍以 scope=live 读取宿主 registry', async () => {
    const registryCalls: unknown[] = []
    const live: AgentFace = { id: 'session-live' }
    const call = mount({
      registry: registryOf('host-with-scope', registryCalls),
      agents: { get: () => live },
    })

    const res = await call(`${ROUTES.overview}?cwd=%2Fworkspace%2Fdemo&sessionId=${live.id}`)

    expect(res.status).toBe(200)
    expect(registryCalls).toEqual([{ cwd: '/workspace/demo', scope: live }])
    expect(res.json().skills.skills.map((entry: { name: string }) => entry.name)).toEqual(['host-with-scope'])
  })

  it('preset 专属 skills 服务解析抛错时回退宿主 registry（仍带 scope）并给出 warning', async () => {
    const registryCalls: unknown[] = []
    const live: AgentFace = { id: 'session-live' }
    const call = mount({
      registry: registryOf('host-with-scope', registryCalls),
      agents: { get: () => live },
      presets: {
        serviceFor: () => {
          throw new Error('preset boom')
        },
      },
    })

    const res = await call(`${ROUTES.overview}?cwd=%2Fworkspace%2Fdemo&sessionId=${live.id}`)

    expect(res.status).toBe(200)
    expect(registryCalls).toEqual([{ cwd: '/workspace/demo', scope: live }])
    expect(res.json().skills.skills.map((entry: { name: string }) => entry.name)).toEqual(['host-with-scope'])
    expect(res.json().skills.warnings.join('\n')).toMatch(/preset boom/)
  })

  it('没有 live Agent 时保持全局兼容视图，并给出诚实 warning（不冒充会话结果）', async () => {
    const hostCalls: unknown[] = []
    const serviceForCalls: unknown[] = []
    const call = mount({
      registry: registryOf('host-only', hostCalls),
      agents: { get: () => undefined },
      presets: {
        serviceFor: (...args: unknown[]) => {
          serviceForCalls.push(args)
          return undefined
        },
      },
    })

    const res = await call(`${ROUTES.overview}?cwd=%2Fworkspace%2Fdemo&sessionId=cold-session`)

    expect(res.status).toBe(200)
    // 兼容：仍按旧行为读全局 registry（无 scope）。
    expect(hostCalls).toEqual([{ cwd: '/workspace/demo' }])
    expect(serviceForCalls).toEqual([])
    expect(res.json().skills.skills.map((entry: { name: string }) => entry.name)).toEqual(['host-only'])
    const warnings = res.json().skills.warnings.join('\n')
    expect(warnings).toMatch(/没有运行中的 Agent/)
    expect(warnings).toMatch(/仅展示全局注册表/)
  })

  it('sessionId 非法（超长）→ 400 invalid_input，不进入 Skills 聚合', async () => {
    const hostCalls: unknown[] = []
    const call = mount({
      registry: registryOf('host-only', hostCalls),
      agents: { get: () => undefined },
    })

    const res = await call(`${ROUTES.overview}?sessionId=${'x'.repeat(257)}`)

    expect(res.status).toBe(400)
    expect(res.json().error.code).toBe('invalid_input')
    expect(hostCalls).toEqual([])
  })
})
