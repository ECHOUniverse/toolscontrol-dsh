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
import { PLUGIN_NAME, PLUGIN_VERSION, type OverviewSnapshot } from '../src/shared/protocol.ts'

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

/** rc.5 形态：mode=config、连接状态/工具/probe 能力全关。 */
function snapshotOf(cwd: string | null, overrides: Partial<OverviewSnapshot> = {}): OverviewSnapshot {
  return {
    plugin: PLUGIN_NAME,
    version: PLUGIN_VERSION,
    generatedAt: 1_700_000_000_000,
    mcp: {
      mode: 'config',
      capabilities: { connectionStatus: false, toolCount: false, probe: false },
      servers: [
        { name: 'siyuan', enabled: true, configured: true, status: 'unknown', source: 'unknown', scope: 'profile' },
        { name: 'zotero', enabled: false, configured: true, status: 'unknown', source: 'unknown', scope: 'profile' },
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
    probe: async () => ({ ok: true, toolNames: [] }),
    sessions,
    workspaces,
    now: () => 1_000,
    ...overrides,
  })
  return { controller, fetch, sessions, workspaces }
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
      probe: async () => ({ ok: true, toolNames: ['tool_a'] }),
    })
    const managed = snapshotOf(null, {
      mcp: {
        mode: 'managed',
        capabilities: { connectionStatus: true, toolCount: true, probe: true },
        servers: [{ name: 'siyuan', enabled: true, configured: true, status: 'connected', source: 'unknown', scope: 'unknown', toolCount: 1 }],
        warnings: [],
      },
    })
    controller.ensure()
    fetch.settle(0, managed)
    await Promise.resolve()
    await Promise.resolve()
    controller.requestProbe('siyuan')
    await Promise.resolve()
    await Promise.resolve()
    expect(stateOf(controller).probes['siyuan']?.phase).toBe('ok')
    controller.refresh()
    fetch.settle(1, managed)
    await Promise.resolve()
    await Promise.resolve()
    expect(stateOf(controller).probes['siyuan']).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// slice 5b：probe 只能显式触发且能力关闭时不调用
// ---------------------------------------------------------------------------

describe('probe 门控（slice 5b）', () => {
  it('capabilities.probe=false（rc.5）→ 不发起任何 probe 请求', async () => {
    let probeCalls = 0
    const { controller, fetch } = controllerWith({
      probe: async () => {
        probeCalls += 1
        return { ok: true, toolNames: [] }
      },
    })
    controller.ensure()
    fetch.settle(0, snapshotOf(null))
    await Promise.resolve()
    await Promise.resolve()
    controller.requestProbe('siyuan')
    await Promise.resolve()
    await Promise.resolve()
    expect(probeCalls).toBe(0)
    expect(stateOf(controller).probes['siyuan']).toBeUndefined()
  })

  it('capabilities.probe=true → 显式点击才 POST；loading/成功/失败可见', async () => {
    const gates = deferred<{ ok: true; toolNames: string[] } | { ok: false; code: 'probe_failed'; message: string }>()
    let probeCalls = 0
    const { controller, fetch } = controllerWith({
      probe: (args) => {
        probeCalls += 1
        expect(args.server).toBe('siyuan')
        return gates.promise
      },
    })
    const managed = snapshotOf(null, {
      mcp: {
        mode: 'managed',
        capabilities: { connectionStatus: true, toolCount: true, probe: true },
        servers: [{ name: 'siyuan', enabled: true, configured: true, status: 'connected', source: 'unknown', scope: 'unknown', toolCount: 2 }],
        warnings: [],
      },
    })
    controller.ensure()
    fetch.settle(0, managed)
    await Promise.resolve()
    await Promise.resolve()

    controller.requestProbe('siyuan')
    expect(probeCalls).toBe(1)
    expect(stateOf(controller).probes['siyuan']?.phase).toBe('loading')

    // 加载中重复触发被忽略
    controller.requestProbe('siyuan')
    expect(probeCalls).toBe(1)

    gates.resolve({ ok: true, toolNames: ['mcp__siyuan__query'] })
    await Promise.resolve()
    await Promise.resolve()
    expect(stateOf(controller).probes['siyuan']).toEqual({
      server: 'siyuan',
      phase: 'ok',
      toolNames: ['mcp__siyuan__query'],
    })
  })

  it('probe 失败（ok:false）呈现失败信息', async () => {
    const { controller, fetch } = controllerWith({
      probe: async () => ({ ok: false, code: 'probe_failed', message: 'handshake timed out' }),
    })
    const managed = snapshotOf(null, {
      mcp: {
        mode: 'managed',
        capabilities: { connectionStatus: true, toolCount: true, probe: true },
        servers: [{ name: 'siyuan', enabled: true, configured: true, status: 'connected', source: 'unknown', scope: 'unknown' }],
        warnings: [],
      },
    })
    controller.ensure()
    fetch.settle(0, managed)
    await Promise.resolve()
    await Promise.resolve()
    controller.requestProbe('siyuan')
    await Promise.resolve()
    await Promise.resolve()
    const probe = stateOf(controller).probes['siyuan']
    expect(probe?.phase).toBe('failed')
    expect(probe?.message).toBe('handshake timed out')
  })

  it('没有快照时 probe 不触发', async () => {
    let probeCalls = 0
    const { controller } = controllerWith({
      probe: async () => {
        probeCalls += 1
        return { ok: true, toolNames: [] }
      },
    })
    controller.requestProbe('siyuan')
    expect(probeCalls).toBe(0)
  })

  it('两个 server 并发显式 probe：乱序完成各自发布，互不覆盖（按 server 代次）', async () => {
    const gateA = deferred<{ ok: true; toolNames: string[] } | { ok: false; code: 'probe_failed'; message: string }>()
    const gateB = deferred<{ ok: true; toolNames: string[] } | { ok: false; code: 'probe_failed'; message: string }>()
    const requested: string[] = []
    const { controller, fetch } = controllerWith({
      probe: (args) => {
        requested.push(args.server)
        return args.server === 'alpha' ? gateA.promise : gateB.promise
      },
    })
    const managed = snapshotOf(null, {
      mcp: {
        mode: 'managed',
        capabilities: { connectionStatus: true, toolCount: true, probe: true },
        servers: [
          { name: 'alpha', enabled: true, configured: true, status: 'connected', source: 'unknown', scope: 'unknown' },
          { name: 'beta', enabled: true, configured: true, status: 'connected', source: 'unknown', scope: 'unknown' },
        ],
        warnings: [],
      },
    })
    controller.ensure()
    fetch.settle(0, managed)
    await Promise.resolve()
    await Promise.resolve()

    // A 先发、仍在途时点击 B
    controller.requestProbe('alpha')
    expect(requested).toEqual(['alpha'])
    controller.requestProbe('beta')
    expect(requested).toEqual(['alpha', 'beta'])
    expect(stateOf(controller).probes['alpha']?.phase).toBe('loading')
    expect(stateOf(controller).probes['beta']?.phase).toBe('loading')

    // B 先完成：B 发布成功，A 不受影响仍 loading
    gateB.resolve({ ok: true, toolNames: ['tool_beta'] })
    await Promise.resolve()
    await Promise.resolve()
    expect(stateOf(controller).probes['beta']).toEqual({ server: 'beta', phase: 'ok', toolNames: ['tool_beta'] })
    expect(stateOf(controller).probes['alpha']?.phase).toBe('loading')

    // A 后完成：A 必须正确发布（不得因 B 抢占全局代次而永久丢失）
    gateA.resolve({ ok: false, code: 'probe_failed', message: 'alpha handshake failed' })
    await Promise.resolve()
    await Promise.resolve()
    expect(stateOf(controller).probes['alpha']).toEqual({ server: 'alpha', phase: 'failed', message: 'alpha handshake failed' })
    // B 的结果保持原样
    expect(stateOf(controller).probes['beta']).toEqual({ server: 'beta', phase: 'ok', toolNames: ['tool_beta'] })
  })

  it('dispose 使全部在途 probe 失效：迟到的结算不得发布', async () => {
    const gateA = deferred<{ ok: true; toolNames: string[] }>()
    const gateB = deferred<{ ok: true; toolNames: string[] }>()
    const requested: string[] = []
    const { controller, fetch } = controllerWith({
      probe: (args) => {
        requested.push(args.server)
        return args.server === 'alpha' ? gateA.promise : gateB.promise
      },
    })
    const managed = snapshotOf(null, {
      mcp: {
        mode: 'managed',
        capabilities: { connectionStatus: true, toolCount: true, probe: true },
        servers: [
          { name: 'alpha', enabled: true, configured: true, status: 'connected', source: 'unknown', scope: 'unknown' },
          { name: 'beta', enabled: true, configured: true, status: 'connected', source: 'unknown', scope: 'unknown' },
        ],
        warnings: [],
      },
    })
    controller.ensure()
    fetch.settle(0, managed)
    await Promise.resolve()
    await Promise.resolve()
    controller.requestProbe('alpha')
    controller.requestProbe('beta')
    controller.dispose()
    gateA.resolve({ ok: true, toolNames: ['late_a'] })
    gateB.resolve({ ok: true, toolNames: ['late_b'] })
    await Promise.resolve()
    await Promise.resolve()
    expect(stateOf(controller).probes['alpha']?.phase).toBe('loading')
    expect(stateOf(controller).probes['beta']?.phase).toBe('loading')
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
