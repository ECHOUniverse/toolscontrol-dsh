/**
 * Client 公共控制器测试（slice 4/5）：工作区解析与切换竞态、刷新语义、
 * probe 门控、筛选动作、语言重排。
 *
 * 测试接缝：ToolscontrolController 的公开 getSnapshot/subscribe 与动作方法；
 * 依赖（fetchOverview/probe/sessions/workspaces/now）全部注入伪造。
 * 不测私有方法，不做 React 组件交互测试。
 */
import { describe, expect, it } from 'vitest'
import { resolveWorkspaceContext, NO_WORKSPACE } from '../src/client/workspace.ts'
import type { SessionsListShape, WorkspacesListShape } from '../src/client/workspace.ts'
import { ToolscontrolController } from '../src/client/controller.ts'
import type { ControllerDeps, ClientState, ObservableStore } from '../src/client/controller.ts'
import {
  PLUGIN_NAME,
  PLUGIN_VERSION,
  type McpProbeResponse,
  type McpServerEntry,
  type McpSnapshot,
  type OverviewSnapshot,
} from '../src/shared/protocol.ts'

// ---------------------------------------------------------------------------
// 装置
// ---------------------------------------------------------------------------

class FakeStore<T> implements ObservableStore<T> {
  private listeners = new Set<() => void>()
  constructor(private snap: T) {}
  getSnapshot(): T {
    return this.snap
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  set(next: T): void {
    this.snap = next
    for (const listener of [...this.listeners]) listener()
  }
  /** Public observation seam: how many subscriptions the store currently holds. */
  listenerCount(): number {
    return this.listeners.size
  }
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason: unknown) => void } {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** rc.5 形态：mode=config、连接状态/工具能力关闭，但独立探测可用。 */
function snapshotOf(cwd: string | null, overrides: Partial<OverviewSnapshot> = {}): OverviewSnapshot {
  return {
    plugin: PLUGIN_NAME,
    version: PLUGIN_VERSION,
    generatedAt: 1_700_000_000_000,
    mcp: {
      mode: 'config',
      capabilities: { connectionStatus: false, toolCount: false, probe: false },
      probe: {
        available: true,
        manualOnly: true,
        maxConcurrent: 2,
        timeoutMs: 10_000,
        profile: true,
        presets: true,
      },
      servers: [
        {
          name: 'siyuan',
          enabled: true,
          configured: true,
          status: 'unknown',
          source: 'unknown',
          scope: 'profile',
          probeKey: 'profile:siyuan',
          probeAvailable: true,
        },
        {
          name: 'zotero',
          enabled: false,
          configured: true,
          status: 'unknown',
          source: 'unknown',
          scope: 'profile',
          probeKey: 'profile:zotero',
          probeAvailable: false,
          probeUnavailableReason: 'disabled',
        },
      ],
      warnings: [],
    },
    skills: {
      cwd,
      skills: [
        {
          name: 'review',
          description: 'code review',
          source: 'project-dsh',
          visibility: 'effective',
          invocation: { modelInvocable: true, userInvocable: true },
        },
        {
          name: 'review',
          description: 'older copy',
          source: 'user-agents',
          visibility: 'shadowed',
          shadowedBy: 'project-dsh',
        },
      ],
      warnings: ['runtime sources cannot be fully enumerated'],
    },
    ...overrides,
  }
}

interface FetchCall {
  cwd: string | undefined
  sessionId: string | undefined
  signal: AbortSignal
}

/** 受控 fetchOverview：每次调用记录 (cwd, sessionId, signal)，返回外部可结算的 promise。 */
function fakeFetch() {
  const calls: FetchCall[] = []
  const pending: { resolve: (value: OverviewSnapshot) => void; reject: (reason: unknown) => void }[] = []
  const fn = (args: { cwd?: string; sessionId?: string; signal: AbortSignal }): Promise<OverviewSnapshot> => {
    calls.push({ cwd: args.cwd, sessionId: args.sessionId, signal: args.signal })
    const gate = deferred<OverviewSnapshot>()
    pending.push(gate)
    return gate.promise
  }
  return {
    fn,
    calls,
    settle(index: number, value: OverviewSnapshot): void {
      pending[index]!.resolve(value)
    },
    fail(index: number, reason: unknown): void {
      pending[index]!.reject(reason)
    },
  }
}

/** 同步取当前状态（控制器快照引用稳定，可直接断言）。 */
function stateOf(controller: ToolscontrolController): ClientState {
  return controller.getSnapshot()
}

function sessionsWith(main: { id: string; cwd?: string } | null): FakeStore<SessionsListShape> {
  const byId: SessionsListShape['byId'] = {}
  if (main !== null) {
    byId[main.id] = {
      id: main.id,
      cwd: main.cwd,
      retainedBy: { mainView: 1 },
    }
  }
  return new FakeStore<SessionsListShape>({ ids: Object.keys(byId), byId, phase: 'ready' })
}

function controllerWith(overrides: Partial<ControllerDeps> = {}): {
  controller: ToolscontrolController
  fetch: ReturnType<typeof fakeFetch>
  sessions: FakeStore<SessionsListShape>
  workspaces: FakeStore<WorkspacesListShape>
} {
  const fetch = fakeFetch()
  const sessions = sessionsWith(null)
  const workspaces = new FakeStore<WorkspacesListShape>({ items: [] })
  const controller = new ToolscontrolController({
    fetchOverview: fetch.fn,
    probe: async (args) => successOf(args.probeKey),
    sessions,
    workspaces,
    now: () => 1_000,
    ...overrides,
  })
  return { controller, fetch, sessions, workspaces }
}

/** 成功探测响应（0 工具也合法）。 */
function successOf(probeKey: string, toolNames: string[] = []): McpProbeResponse {
  return {
    ok: true,
    probeKey,
    scope: 'profile',
    entryId: null,
    probedAt: 2_000,
    durationMs: 12,
    toolNames,
    toolCount: toolNames.length,
  }
}

/** 等待控制器内部 promise 链（fetch/probe 的微任务）稳定。 */
async function flush(rounds = 4): Promise<void> {
  for (let index = 0; index < rounds; index += 1) await Promise.resolve()
}

// ---------------------------------------------------------------------------
// slice 4a：工作区解析（纯函数）
// ---------------------------------------------------------------------------

describe('resolveWorkspaceContext（slice 4a）', () => {
  it('主 Session（retainedBy.mainView>0）决定 cwd，workspace 由 sessionIds 归属校验', () => {
    const sessions: SessionsListShape = {
      ids: ['s1', 's2'],
      byId: {
        s1: { id: 's1', cwd: '/home/me/proj-a', retainedBy: { sidebar: 1 } },
        s2: { id: 's2', cwd: '/home/me/proj-b', retainedBy: { mainView: 2 } },
      },
      phase: 'ready',
    }
    const workspaces: WorkspacesListShape = {
      items: [
        { workspaceId: 'w1', path: '/home/me/proj-a', title: 'proj-a', sessionIds: ['s1'] },
        { workspaceId: 'w2', path: '/home/me/proj-b', title: 'proj-b', sessionIds: ['s2'] },
      ],
    }
    const ctx = resolveWorkspaceContext(sessions, workspaces)
    expect(ctx).toEqual({ sessionId: 's2', cwd: '/home/me/proj-b', workspaceId: 'w2', workspaceTitle: 'proj-b' })
  })

  it('没有主 Session 时 cwd=null（不猜默认目录）', () => {
    const sessions: SessionsListShape = {
      ids: ['s1'],
      byId: { s1: { id: 's1', cwd: '/x', retainedBy: { sidebar: 3 } } },
      phase: 'ready',
    }
    expect(resolveWorkspaceContext(sessions, { items: [] })).toEqual(NO_WORKSPACE)
  })

  it('主 Session 无 cwd 时 cwd=null 但保留 sessionId', () => {
    const sessions: SessionsListShape = {
      ids: ['s1'],
      byId: { s1: { id: 's1', retainedBy: { mainView: 1 } } },
      phase: 'ready',
    }
    const ctx = resolveWorkspaceContext(sessions, undefined)
    expect(ctx.cwd).toBeNull()
    expect(ctx.sessionId).toBe('s1')
  })

  it('空/畸形快照防御为 NO_WORKSPACE', () => {
    expect(resolveWorkspaceContext(undefined, undefined)).toEqual(NO_WORKSPACE)
    expect(resolveWorkspaceContext({}, {})).toEqual(NO_WORKSPACE)
  })
})

// ---------------------------------------------------------------------------
// slice 4b：进入标签获取快照 + 工作区切换竞态
// ---------------------------------------------------------------------------

describe('工作区跟踪与切换竞态（slice 4b）', () => {
  it('ensure() 首次进入获取快照（无主 Session → 不带 cwd）', async () => {
    const { controller, fetch } = controllerWith()
    controller.ensure()
    expect(fetch.calls).toHaveLength(1)
    expect(fetch.calls[0]!.cwd).toBeUndefined()
    fetch.settle(0, snapshotOf(null))
    await Promise.resolve()
    await Promise.resolve()
    const state = stateOf(controller)
    expect(state.status).toBe('ready')
    expect(state.workspace).toEqual(NO_WORKSPACE)
    expect(state.lastRefreshedAt).toBe(1_000)
  })

  it('主 Session 决定 sessionId 并随请求发送；同一 cwd 切换到另一 Session 也重新获取', async () => {
    const { controller, fetch, sessions } = controllerWith()
    controller.ensure()
    expect(fetch.calls[0]!.sessionId).toBeUndefined()

    sessions.set({
      ids: ['a'],
      byId: { a: { id: 'a', cwd: '/home/me/proj-a', retainedBy: { mainView: 1 } } },
      phase: 'ready',
    })
    expect(fetch.calls).toHaveLength(2)
    expect(fetch.calls[1]).toMatchObject({ cwd: '/home/me/proj-a', sessionId: 'a' })

    // 同一 cwd 下切换主 Session：会话级 preset scope 可能不同，必须重新获取。
    sessions.set({
      ids: ['b'],
      byId: { b: { id: 'b', cwd: '/home/me/proj-a', retainedBy: { mainView: 1 } } },
      phase: 'ready',
    })
    expect(fetch.calls).toHaveLength(3)
    expect(fetch.calls[2]).toMatchObject({ cwd: '/home/me/proj-a', sessionId: 'b' })
  })

  it('重入（再次 ensure，重新进入标签页）重新获取快照，且 store 只挂载一次', async () => {
    const { controller, fetch, sessions, workspaces } = controllerWith()
    controller.ensure()
    controller.ensure() // 重新进入标签页：重新获取
    expect(fetch.calls.map((call) => call.cwd)).toEqual([undefined, undefined])
    // 不重复 attach stores：订阅各恰好一次
    expect(sessions.listenerCount()).toBe(1)
    expect(workspaces.listenerCount()).toBe(1)
    // 订阅唯一 ⇒ cwd 变化只触发一次新获取
    sessions.set({
      ids: ['a'],
      byId: { a: { id: 'a', cwd: '/home/me/proj-a', retainedBy: { mainView: 1 } } },
      phase: 'ready',
    })
    expect(fetch.calls).toHaveLength(3)
    expect(fetch.calls[2]!.cwd).toBe('/home/me/proj-a')
  })

  it('工作区切换更新 cwd 并重新获取；旧请求被中止且不得覆盖新 cwd 数据', async () => {
    const { controller, fetch, sessions } = controllerWith()
    controller.ensure()

    sessions.set({
      ids: ['a'],
      byId: { a: { id: 'a', cwd: '/home/me/proj-a', retainedBy: { mainView: 1 } } },
      phase: 'ready',
    })
    // 第二次 fetch（cwd=/a）挂起中
    expect(fetch.calls).toHaveLength(2)
    expect(fetch.calls[1]!.cwd).toBe('/home/me/proj-a')

    // 切换到工作区 B：旧请求中止，新请求以 cwd=/b 发出
    sessions.set({
      ids: ['b'],
      byId: { b: { id: 'b', cwd: '/home/me/proj-b', retainedBy: { mainView: 1 } } },
      phase: 'ready',
    })
    expect(fetch.calls).toHaveLength(3)
    expect(fetch.calls[1]!.signal.aborted).toBe(true)
    expect(fetch.calls[2]!.cwd).toBe('/home/me/proj-b')

    // B 先返回
    fetch.settle(2, snapshotOf('/home/me/proj-b'))
    await Promise.resolve()
    await Promise.resolve()
    expect(stateOf(controller).snapshot?.skills.cwd).toBe('/home/me/proj-b')

    // 迟到的 A 返回 —— 不得覆盖 B 的数据
    fetch.settle(1, snapshotOf('/home/me/proj-a'))
    await Promise.resolve()
    await Promise.resolve()
    expect(stateOf(controller).snapshot?.skills.cwd).toBe('/home/me/proj-b')
    expect(stateOf(controller).status).toBe('ready')
  })

  it('cwd 未变化的 store 通知不触发重新获取', async () => {
    const { controller, fetch, workspaces } = controllerWith()
    controller.ensure()
    expect(fetch.calls).toHaveLength(1)
    workspaces.set({ items: [{ workspaceId: 'w1', path: '/x', title: 'X', sessionIds: [] }] })
    expect(fetch.calls).toHaveLength(1)
  })

  it('refresh() 以当前 cwd 重新获取并中止在途请求', async () => {
    const { controller, fetch, sessions } = controllerWith()
    controller.ensure()
    sessions.set({
      ids: ['a'],
      byId: { a: { id: 'a', cwd: '/home/me/proj-a', retainedBy: { mainView: 1 } } },
      phase: 'ready',
    })
    expect(fetch.calls).toHaveLength(2)
    controller.refresh()
    expect(fetch.calls).toHaveLength(3)
    expect(fetch.calls[1]!.signal.aborted).toBe(true)
    expect(fetch.calls[2]!.cwd).toBe('/home/me/proj-a')
  })

  it('dispose 后停止响应 store 变化', async () => {
    const { controller, fetch, sessions } = controllerWith()
    controller.ensure()
    controller.dispose()
    sessions.set({
      ids: ['a'],
      byId: { a: { id: 'a', cwd: '/a', retainedBy: { mainView: 1 } } },
      phase: 'ready',
    })
    expect(fetch.calls).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// slice 5a：刷新成功/失败保留旧数据
// ---------------------------------------------------------------------------

describe('刷新保留旧数据（slice 5a）', () => {
  it('失败且无旧数据 → status=error 的错误空态', async () => {
    const { controller, fetch } = controllerWith()
    controller.ensure()
    fetch.fail(0, new Error('boom'))
    await Promise.resolve()
    await Promise.resolve()
    const state = stateOf(controller)
    expect(state.status).toBe('error')
    expect(state.snapshot).toBeNull()
    expect(state.error).toBe('boom')
    expect(state.stale).toBe(false)
  })

  it('失败但有旧数据 → 保留快照并提示（stale）', async () => {
    const { controller, fetch } = controllerWith()
    controller.ensure()
    fetch.settle(0, snapshotOf(null))
    await Promise.resolve()
    await Promise.resolve()
    controller.refresh()
    fetch.fail(1, new Error('network down'))
    await Promise.resolve()
    await Promise.resolve()
    const state = stateOf(controller)
    expect(state.status).toBe('ready')
    expect(state.snapshot).not.toBeNull()
    expect(state.error).toBe('network down')
    expect(state.stale).toBe(true)
    expect(state.snapshot?.mcp.servers).toHaveLength(2)
  })

  it('失败重试成功 → 清除错误与 stale', async () => {
    const { controller, fetch } = controllerWith()
    controller.ensure()
    fetch.fail(0, new Error('first'))
    await Promise.resolve()
    await Promise.resolve()
    controller.refresh()
    fetch.settle(1, snapshotOf(null))
    await Promise.resolve()
    await Promise.resolve()
    const state = stateOf(controller)
    expect(state.status).toBe('ready')
    expect(state.error).toBeNull()
    expect(state.stale).toBe(false)
  })

  it('成功后清除 probe 结果（旧探测不映射到新快照）', async () => {
    const { controller, fetch } = controllerWith({
      probe: async (args) => successOf(args.probeKey, ['tool_a']),
    })
    controller.ensure()
    fetch.settle(0, snapshotOf(null))
    await flush()
    controller.requestProbe('profile:siyuan')
    await flush()
    expect(stateOf(controller).probes['profile:siyuan']?.phase).toBe('ok')
    controller.refresh()
    fetch.settle(1, snapshotOf(null))
    await flush()
    expect(stateOf(controller).probes['profile:siyuan']).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// slice 5b：显式 probe 以 probeKey 为键；能力/条目门控、批量、取消与代次
// ---------------------------------------------------------------------------

/** 装载一份快照后返回控制器，并统计 probe 调用次数。 */
async function settledWith(
  snapshot: OverviewSnapshot,
  overrides: Partial<ControllerDeps> = {},
): Promise<{ controller: ToolscontrolController; probeCalls: () => number }> {
  let calls = 0
  const { controller, fetch } = controllerWith({
    probe: async (args) => {
      calls += 1
      return successOf(args.probeKey)
    },
    ...overrides,
  })
  controller.ensure()
  fetch.settle(0, snapshot)
  await flush()
  return { controller, probeCalls: () => calls }
}

/** 以给定服务器列表构造 config 快照（默认保留可用探测能力）。 */
function snapshotWithServers(servers: McpServerEntry[], mcpPatch: Partial<McpSnapshot> = {}): OverviewSnapshot {
  return snapshotOf(null, { mcp: { ...snapshotOf(null).mcp, servers, ...mcpPatch } })
}

function server(overrides: Partial<McpServerEntry> & { name: string; probeKey: string }): McpServerEntry {
  return {
    enabled: true,
    configured: true,
    status: 'unknown',
    source: 'unknown',
    scope: 'profile',
    probeAvailable: true,
    ...overrides,
  }
}

describe('显式 probe（probeKey，slice 5b）', () => {
  it('快照落地不自动 probe；capabilities.probe=false 不再门控', async () => {
    let calls = 0
    const { controller, fetch } = controllerWith({
      probe: async (args) => {
        calls += 1
        return successOf(args.probeKey)
      },
    })
    controller.ensure()
    fetch.settle(0, snapshotOf(null))
    await flush()
    expect(calls).toBe(0)
    expect(stateOf(controller).probes).toEqual({})
    // rc.5：capabilities.probe=false，但 mcp.probe.available=true。
    expect(stateOf(controller).snapshot?.mcp.capabilities.probe).toBe(false)
    controller.requestProbe('profile:siyuan')
    await flush()
    expect(calls).toBe(1)
  })

  it('mcp.probe 缺失或 available=false → 单条与全部都不发起', async () => {
    const base = snapshotOf(null).mcp
    const { probe: _probe, ...missingProbe } = base
    const missing = snapshotOf(null, { mcp: missingProbe })
    const unavailable = snapshotOf(null, {
      mcp: {
        ...base,
        probe: { available: false, manualOnly: true, maxConcurrent: 2, timeoutMs: 10_000, profile: false, presets: false, reason: 'config_source_unavailable' },
      },
    })

    const first = await settledWith(missing)
    first.controller.requestProbe('profile:siyuan')
    first.controller.requestProbeAll()
    expect(first.probeCalls()).toBe(0)
    expect(stateOf(first.controller).mcpProbeableCount).toBe(0)

    const second = await settledWith(unavailable)
    second.controller.requestProbe('profile:siyuan')
    second.controller.requestProbeAll()
    expect(second.probeCalls()).toBe(0)
  })

  it('禁用 / probeAvailable=false / conditional 条目一律不发起', async () => {
    const { controller, probeCalls } = await settledWith(
      snapshotWithServers([
        server({ name: 'off', probeKey: 'profile:off', enabled: false, probeAvailable: false }),
        server({ name: 'noprobe', probeKey: 'profile:noprobe', probeAvailable: false }),
        server({ name: 'cond', probeKey: 'profile:cond', conditional: true }),
        server({ name: 'ok', probeKey: 'profile:ok' }),
      ]),
    )
    controller.requestProbe('profile:off')
    controller.requestProbe('profile:noprobe')
    controller.requestProbe('profile:cond')
    // 不存在的键同样不发起。
    controller.requestProbe('profile:missing')
    expect(probeCalls()).toBe(0)
    // 默认筛选（enabled）下 cond 行仍显示，但只有 ok 计为可探测。
    expect(stateOf(controller).mcpRows.map((row) => row.probeKey)).toEqual([
      'profile:cond',
      'profile:noprobe',
      'profile:ok',
    ])
    expect(stateOf(controller).mcpProbeableCount).toBe(1)
    controller.requestProbeAll()
    expect(probeCalls()).toBe(1)
  })

  it('单条：loading → ok，保留观测时间/耗时/工具名/数量；重复点击被忽略', async () => {
    const gate = deferred<McpProbeResponse>()
    const requested: { probeKey: string; signal: AbortSignal }[] = []
    const { controller } = await settledWith(snapshotOf(null), {
      probe: (args) => {
        requested.push(args)
        return gate.promise
      },
    })
    controller.requestProbe('profile:siyuan')
    expect(requested).toHaveLength(1)
    expect(requested[0]!.probeKey).toBe('profile:siyuan')
    expect(requested[0]!.signal).toBeInstanceOf(AbortSignal)
    expect(stateOf(controller).probes['profile:siyuan']).toEqual({ probeKey: 'profile:siyuan', phase: 'loading' })

    // loading 中重复点击：忽略，不叠加请求。
    controller.requestProbe('profile:siyuan')
    expect(requested).toHaveLength(1)

    gate.resolve(successOf('profile:siyuan', ['paper_search', 'read_doc']))
    await flush()
    expect(stateOf(controller).probes['profile:siyuan']).toEqual({
      probeKey: 'profile:siyuan',
      phase: 'ok',
      probedAt: 2_000,
      durationMs: 12,
      toolNames: ['paper_search', 'read_doc'],
      toolCount: 2,
      scope: 'profile',
      entryId: null,
    })
  })

  it('成功但 0 工具是明确成功（toolCount=0，工具名空）', async () => {
    const { controller } = await settledWith(snapshotOf(null))
    controller.requestProbe('profile:siyuan')
    await flush()
    const probe = stateOf(controller).probes['profile:siyuan']
    expect(probe?.phase).toBe('ok')
    if (probe?.phase === 'ok') {
      expect(probe.toolCount).toBe(0)
      expect(probe.toolNames).toEqual([])
    }
  })

  it('失败响应保留 stage/code/message/durationMs，不显示原始错误', async () => {
    const { controller } = await settledWith(snapshotOf(null), {
      probe: async (args): Promise<McpProbeResponse> => ({
        ok: false,
        probeKey: args.probeKey,
        scope: 'profile',
        entryId: null,
        stage: 'timeout',
        code: 'timeout',
        message: '探测超时（10000 毫秒）',
        durationMs: 10_003,
      }),
    })
    controller.requestProbe('profile:siyuan')
    await flush()
    expect(stateOf(controller).probes['profile:siyuan']).toEqual({
      probeKey: 'profile:siyuan',
      phase: 'failed',
      stage: 'timeout',
      code: 'timeout',
      message: '探测超时（10000 毫秒）',
      durationMs: 10_003,
      scope: 'profile',
      entryId: null,
    })
  })

  it('网络/传输失败只发布安全占位（message 为空），不含 URL/原始错误', async () => {
    const { controller } = await settledWith(snapshotOf(null), {
      probe: async () => {
        throw new Error('failed to fetch http://127.0.0.1:9999/secret?token=abc')
      },
    })
    controller.requestProbe('profile:siyuan')
    await flush()
    const probe = stateOf(controller).probes['profile:siyuan']
    expect(probe).toMatchObject({
      probeKey: 'profile:siyuan',
      phase: 'failed',
      stage: 'unavailable',
      code: 'unavailable',
      message: '',
      durationMs: 0,
      transport: true,
    })
    expect(JSON.stringify(probe)).not.toMatch(/127\.0\.0\.1|token=/)
  })

  it('同名但不同 probeKey：结果按 probeKey 隔离，互不覆盖', async () => {
    const gateProfile = deferred<McpProbeResponse>()
    const gatePreset = deferred<McpProbeResponse>()
    const servers = [
      server({ name: 'same', probeKey: 'profile:same', scope: 'profile' }),
      server({ name: 'same', probeKey: 'preset:p1:same', scope: 'preset', preset: { id: 'p1' } }),
    ]
    const { controller } = await settledWith(snapshotWithServers(servers), {
      probe: (args) => (args.probeKey === 'profile:same' ? gateProfile.promise : gatePreset.promise),
    })
    controller.requestProbe('profile:same')
    controller.requestProbe('preset:p1:same')
    expect(stateOf(controller).probes['profile:same']?.phase).toBe('loading')
    expect(stateOf(controller).probes['preset:p1:same']?.phase).toBe('loading')

    gatePreset.resolve({
      ok: false,
      probeKey: 'preset:p1:same',
      stage: 'connect',
      code: 'connect',
      message: '连接 MCP 服务器失败',
      durationMs: 5,
    })
    await flush()
    expect(stateOf(controller).probes['preset:p1:same']?.phase).toBe('failed')
    expect(stateOf(controller).probes['profile:same']?.phase).toBe('loading')

    gateProfile.resolve({ ...successOf('profile:same', ['tool']), scope: 'profile' })
    await flush()
    expect(stateOf(controller).probes['profile:same']).toMatchObject({ phase: 'ok', toolCount: 1 })
    expect(stateOf(controller).probes['preset:p1:same']).toMatchObject({ phase: 'failed', code: 'connect' })
  })

  it('requestProbeAll 只处理当前筛选结果中的可探测条目（跳过 loading）', async () => {
    const requested: string[] = []
    const gates = new Map<string, { promise: Promise<McpProbeResponse>; resolve: (value: McpProbeResponse) => void }>()
    const servers = [
      server({ name: 'alpha', probeKey: 'profile:alpha' }),
      server({ name: 'beta', probeKey: 'profile:beta' }),
      server({ name: 'gamma', probeKey: 'profile:gamma', enabled: false, probeAvailable: false }),
      server({ name: 'delta', probeKey: 'profile:delta', probeAvailable: false }),
      server({ name: 'epsilon', probeKey: 'profile:epsilon', conditional: true }),
    ]
    const { controller } = await settledWith(snapshotWithServers(servers), {
      probe: (args) => {
        requested.push(args.probeKey)
        const gate = deferred<McpProbeResponse>()
        gates.set(args.probeKey, gate)
        return gate.promise
      },
    })
    // 默认 enabled 筛选：gamma（禁用）不显示；epsilon 条件启用不算可探测。
    expect(stateOf(controller).mcpRows.map((row) => row.probeKey)).toEqual([
      'profile:alpha',
      'profile:beta',
      'profile:delta',
      'profile:epsilon',
    ])
    expect(stateOf(controller).mcpProbeableCount).toBe(2)

    // 先手动探测 alpha（仍在途），全部探测必须跳过它、不重复请求。
    controller.requestProbe('profile:alpha')
    expect(requested).toEqual(['profile:alpha'])
    expect(stateOf(controller).mcpProbeableCount).toBe(1)
    controller.requestProbeAll()
    expect(requested).toEqual(['profile:alpha', 'profile:beta'])

    // 筛选变化只改变范围，不自动探测。
    controller.setMcpFilters({ query: 'gamma' })
    expect(stateOf(controller).mcpProbeableCount).toBe(0)
    controller.requestProbeAll()
    expect(requested).toEqual(['profile:alpha', 'profile:beta'])

    // enabled=all 下禁用条目可见，但批量仍跳过。
    controller.setMcpFilters({ query: '', enabled: 'all' })
    expect(stateOf(controller).mcpRows.some((row) => row.probeKey === 'profile:gamma')).toBe(true)
    expect(stateOf(controller).mcpProbeableCount).toBe(0) // alpha/beta 仍在 loading，其余不可探测
    gates.get('profile:alpha')!.resolve(successOf('profile:alpha'))
    gates.get('profile:beta')!.resolve(successOf('profile:beta'))
    await flush()
    expect(stateOf(controller).mcpProbeableCount).toBe(2)
  })

  it('批量探测只针对当前搜索词命中的行', async () => {
    const requested: string[] = []
    const { controller } = await settledWith(
      snapshotWithServers([
        server({ name: 'alpha', probeKey: 'profile:alpha' }),
        server({ name: 'beta', probeKey: 'profile:beta' }),
      ]),
      {
        probe: async (args) => {
          requested.push(args.probeKey)
          return successOf(args.probeKey)
        },
      },
    )
    controller.setMcpFilters({ query: 'beta' })
    expect(stateOf(controller).mcpProbeableCount).toBe(1)
    controller.requestProbeAll()
    await flush()
    expect(requested).toEqual(['profile:beta'])
  })

  it('筛选变化不清空已有探测结果', async () => {
    const { controller } = await settledWith(snapshotOf(null))
    controller.requestProbe('profile:siyuan')
    await flush()
    expect(stateOf(controller).probes['profile:siyuan']?.phase).toBe('ok')
    controller.setMcpFilters({ query: 'siyuan' })
    expect(stateOf(controller).probes['profile:siyuan']?.phase).toBe('ok')
    controller.setMcpFilters({ enabled: 'all' })
    expect(stateOf(controller).probes['profile:siyuan']?.phase).toBe('ok')
  })

  it('dispose 中止全部在途 probe（含批量），迟到结果不得发布', async () => {
    const gates = new Map<string, { promise: Promise<McpProbeResponse>; resolve: (value: McpProbeResponse) => void }>()
    const signals = new Map<string, AbortSignal>()
    const { controller } = await settledWith(
      snapshotWithServers([
        server({ name: 'alpha', probeKey: 'profile:alpha' }),
        server({ name: 'beta', probeKey: 'profile:beta' }),
      ]),
      {
        probe: (args) => {
          const gate = deferred<McpProbeResponse>()
          gates.set(args.probeKey, gate)
          signals.set(args.probeKey, args.signal)
          return gate.promise
        },
      },
    )
    controller.requestProbeAll()
    expect(signals.size).toBe(2)
    expect(stateOf(controller).probes['profile:alpha']?.phase).toBe('loading')
    expect(stateOf(controller).probes['profile:beta']?.phase).toBe('loading')

    controller.dispose()
    expect(signals.get('profile:alpha')?.aborted).toBe(true)
    expect(signals.get('profile:beta')?.aborted).toBe(true)
    gates.get('profile:alpha')!.resolve(successOf('profile:alpha', ['late']))
    gates.get('profile:beta')!.resolve(successOf('profile:beta', ['late']))
    await flush()
    expect(stateOf(controller).probes['profile:alpha']?.phase).toBe('loading')
    expect(stateOf(controller).probes['profile:beta']?.phase).toBe('loading')
  })

  it('load/refresh 使旧 probe 代次失效并 abort；晚到结果不得重新填入', async () => {
    const gate = deferred<McpProbeResponse>()
    let signal: AbortSignal | undefined
    const { controller, fetch } = controllerWith({
      probe: (args) => {
        signal = args.signal
        return gate.promise
      },
    })
    controller.ensure()
    fetch.settle(0, snapshotOf(null))
    await flush()

    controller.requestProbe('profile:siyuan')
    expect(stateOf(controller).probes['profile:siyuan']?.phase).toBe('loading')

    // refresh 开始即中止旧探测代次。
    controller.refresh()
    expect(signal?.aborted).toBe(true)
    fetch.settle(1, snapshotOf(null))
    await flush()
    expect(stateOf(controller).probes).toEqual({})

    // 晚到结果被丢弃，不能重新填入。
    gate.resolve(successOf('profile:siyuan', ['late']))
    await flush()
    expect(stateOf(controller).probes['profile:siyuan']).toBeUndefined()
  })

  it('fetch 在途时发起的 probe 属于旧快照代次：新快照落地后结果被丢弃', async () => {
    const gate = deferred<McpProbeResponse>()
    let signal: AbortSignal | undefined
    const { controller, fetch } = controllerWith({
      probe: (args) => {
        signal = args.signal
        return gate.promise
      },
    })
    controller.ensure()
    fetch.settle(0, snapshotOf(null))
    await flush()

    // 第二次 fetch 在途（仍展示旧快照），此时允许发起探测。
    controller.refresh()
    controller.requestProbe('profile:siyuan')
    expect(stateOf(controller).probes['profile:siyuan']?.phase).toBe('loading')
    fetch.settle(1, snapshotOf(null))
    await flush()
    expect(signal?.aborted).toBe(true)
    expect(stateOf(controller).probes).toEqual({})

    gate.resolve(successOf('profile:siyuan', ['late']))
    await flush()
    expect(stateOf(controller).probes['profile:siyuan']).toBeUndefined()
  })

  it('没有快照时 probe 不触发', async () => {
    let probeCalls = 0
    const { controller } = controllerWith({
      probe: async () => {
        probeCalls += 1
        return successOf('profile:siyuan')
      },
    })
    controller.requestProbe('profile:siyuan')
    controller.requestProbeAll()
    expect(probeCalls).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// 筛选动作与语言重排（经控制器）
// ---------------------------------------------------------------------------

describe('控制器筛选与语言（动作接缝）', () => {
  it('setMcpFilters：默认启用项；切 all 后含禁用项', async () => {
    const { controller, fetch } = controllerWith()
    controller.ensure()
    fetch.settle(0, snapshotOf(null))
    await Promise.resolve()
    await Promise.resolve()
    expect(stateOf(controller).mcpRows.map((row) => row.name)).toEqual(['siyuan'])
    controller.setMcpFilters({ enabled: 'all' })
    expect(stateOf(controller).mcpRows.map((row) => row.name)).toEqual(['siyuan', 'zotero'])
    controller.setMcpFilters({ enabled: 'disabled', query: '' })
    expect(stateOf(controller).mcpRows.map((row) => row.name)).toEqual(['zotero'])
  })

  it('setSkillsFilters：搜索只命中主行，shadowed 随行携带', async () => {
    const { controller, fetch } = controllerWith()
    controller.ensure()
    fetch.settle(0, snapshotOf(null))
    await Promise.resolve()
    await Promise.resolve()
    const state = stateOf(controller)
    expect(state.skillRows).toHaveLength(1)
    expect(state.skillRows[0]!.shadowed).toHaveLength(1)
    controller.setSkillsFilters({ query: 'older copy' })
    expect(stateOf(controller).skillRows).toEqual([])
    controller.setSkillsFilters({ query: 'code review' })
    expect(stateOf(controller).skillRows).toHaveLength(1)
  })

  it('setLanguage 重排主行并保持筛选', async () => {
    const { controller, fetch } = controllerWith()
    const zhSnapshot = snapshotOf(null)
    zhSnapshot.skills.skills = [
      { name: '中文技能', description: 'd', source: 'project-dsh', visibility: 'effective', invocation: { modelInvocable: true, userInvocable: true } },
      { name: 'alpha', description: 'd', source: 'project-dsh', visibility: 'effective', invocation: { modelInvocable: true, userInvocable: true } },
    ]
    controller.ensure()
    fetch.settle(0, zhSnapshot)
    await Promise.resolve()
    await Promise.resolve()
    expect(stateOf(controller).skillRows.map((row) => row.effective?.name)).toEqual(['alpha', '中文技能'])
    controller.setLanguage('zh')
    expect(stateOf(controller).skillRows.map((row) => row.effective?.name)).toEqual(['中文技能', 'alpha'])
    expect(stateOf(controller).language).toBe('zh')
  })

  it('invalidate（plugin-manager 变化）在有快照时重新获取', async () => {
    const { controller, fetch } = controllerWith()
    controller.ensure()
    fetch.settle(0, snapshotOf(null))
    await Promise.resolve()
    await Promise.resolve()
    controller.invalidate()
    expect(fetch.calls).toHaveLength(2)
  })

  it('invalidate 在从未加载时不触发获取', () => {
    const { controller, fetch } = controllerWith()
    controller.invalidate()
    expect(fetch.calls).toHaveLength(0)
  })
})
