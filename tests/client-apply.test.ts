/**
 * Client 装配集成测试：`apply(ctx, overrides)` 面向伪造官方 client context
 * 的公开行为，覆盖注册→控制器→获取→工作区联动→事件失效的完整链路。
 *
 * 覆盖：locale 注册（中英）、两个 plugins.tab 注册（id/order/label）、
 * inject face（controller + t）、进入 tab 的快照获取（进入时而非装配时）、
 * 主 Session 切换触发 cwd 重新获取、官方 plugin-manager/changed 失效事件、
 * 以及 effect 释放后停止响应。不做 React 渲染（组件挂载是宿主职责）。
 */
import { describe, expect, it } from 'vitest'
import { apply, type ClientContext } from '../src/client/ui.tsx'
import { NS } from '../src/client/i18n.ts'
import type { ControllerDeps } from '../src/client/controller.ts'
import type { OverviewSnapshot } from '../src/shared/protocol.ts'
import type { SessionsListShape, WorkspacesListShape } from '../src/client/workspace.ts'
import type { ObservableStore } from '../src/client/controller.ts'

// ---------------------------------------------------------------------------
// 装置：最小官方 client context 伪造
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
}

interface Registration {
  options: Record<string, unknown>
  component: unknown
}

function fakeCtx(sessions: FakeStore<SessionsListShape>, workspaces: FakeStore<WorkspacesListShape>): {
  ctx: ClientContext
  registrations: Registration[]
  handlers: Record<string, (() => void)[]>
  disposers: (() => void)[]
} {
  const dictionaries: Record<string, Record<string, Record<string, string>>> = {}
  const registrations: Registration[] = []
  const handlers: Record<string, (() => void)[]> = {}
  const disposers: (() => void)[] = []
  const translate = (key: string, params?: Record<string, string | number>): string => {
    const template = dictionaries[NS]?.['en']?.[key] ?? key
    if (params === undefined) return template
    return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match))
  }
  const ctx: ClientContext = {
    locale: {
      register: (namespace, dicts) => {
        dictionaries[namespace] = dicts
        return () => {}
      },
      bind: () => translate,
      subscribe: () => () => {},
      getSnapshot: () => ({ active: 'en', revision: 0 }),
    },
    slots: {
      inject: (slot, callback) => {
        const inner = callback()
        return () => {
          inner?.()
        }
      },
      register: (options, component) => {
        registrations.push({ options, component })
        return () => {}
      },
    },
    remote: {
      $on: (event, handler) => {
        ;(handlers[event] ??= []).push(handler)
        return () => {}
      },
    },
    effect: (callback) => {
      const result = callback()
      const disposer = typeof result === 'function' ? result : undefined
      if (disposer !== undefined) disposers.push(disposer)
      return () => {
        disposer?.()
      }
    },
    get: (name) => (name === 'sessions' ? ({ list: sessions } as unknown) : name === 'workspaces' ? ({ list: workspaces } as unknown) : undefined),
  }
  return { ctx, registrations, handlers, disposers }
}

function snapshotOf(cwd: string | null): OverviewSnapshot {
  return {
    plugin: 'test',
    version: '0',
    generatedAt: 0,
    mcp: {
      mode: 'config',
      capabilities: { connectionStatus: false, toolCount: false, probe: false },
      servers: [{ name: 'siyuan', enabled: true, configured: true, status: 'unknown', source: 'unknown' }],
      warnings: [],
    },
    skills: { cwd, skills: [], warnings: [] },
  }
}

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------

describe('apply(ctx) 装配（集成接缝）', () => {
  it('注册中英字典与两个 plugins.tab（id mcp/skills、order 100/110、标签可解析）', () => {
    const { ctx, registrations } = fakeCtx(new FakeStore({ ids: [], byId: [] }), new FakeStore({ items: [] }))
    apply(ctx)
    const labels = registrations.map((registration) => registration.options.label) as (() => string)[]
    expect(registrations.map((registration) => registration.options.id)).toEqual(['mcp', 'skills'])
    expect(registrations.map((registration) => registration.options.order)).toEqual([100, 110])
    expect(registrations.map((registration) => registration.options.locale)).toEqual([NS, NS])
    expect(labels[0]!()).toBe('MCP')
    expect(labels[1]!()).toBe('Skills')
    const face = registrations[0]!.options.inject as () => { tc: unknown; t: (key: string) => string }
    expect(typeof face().t).toBe('function')
    expect(face().t('tab.skills')).toBe('Skills')
  })

  it('face controller：进入时获取快照（幂等）、主 Session 切换联动 cwd、事件失效、释放后停止', async () => {
    const sessions = new FakeStore<SessionsListShape>({ ids: [], byId: [] })
    const workspaces = new FakeStore<WorkspacesListShape>({ items: [] })
    const { ctx, registrations, handlers, disposers } = fakeCtx(sessions, workspaces)
    const fetchCalls: (string | undefined)[] = []
    const gates: ((value: OverviewSnapshot) => void)[] = []
    const overrides: Partial<ControllerDeps> = {
      fetchOverview: (args) => {
        fetchCalls.push(args.cwd)
        return new Promise<OverviewSnapshot>((resolve) => {
          gates.push(resolve)
        })
      },
    }
    apply(ctx, overrides)

    const face = registrations[0]!.options.inject as () => { tc: import('../src/client/controller.ts').ToolscontrolController }
    const tc = face().tc
    expect(handlers['plugin-manager/changed']).toHaveLength(1)

    // 装配本身不获取；进入 tab（ensure）才获取；重入（重新进入标签页）重新获取
    expect(fetchCalls).toHaveLength(0)
    tc.ensure()
    expect(fetchCalls).toEqual([undefined])
    gates[0]!(snapshotOf(null))
    await Promise.resolve()
    await Promise.resolve()
    expect(tc.getSnapshot().status).toBe('ready')
    tc.ensure()
    expect(fetchCalls).toEqual([undefined, undefined])
    gates[1]!(snapshotOf(null))
    await Promise.resolve()
    await Promise.resolve()
    expect(tc.getSnapshot().status).toBe('ready')

    // 主 Session 出现 → cwd 联动重新获取
    sessions.set({ ids: ['a'], byId: { a: { id: 'a', cwd: '/home/me/proj-a', retainedBy: { mainView: 1 } } } })
    expect(fetchCalls).toEqual([undefined, undefined, '/home/me/proj-a'])
    gates[2]!(snapshotOf('/home/me/proj-a'))
    await Promise.resolve()
    await Promise.resolve()
    expect(tc.getSnapshot().cwd).toBe('/home/me/proj-a')

    // 官方 plugin-manager/changed → 失效重取（保留当前 cwd）
    handlers['plugin-manager/changed'][0]!()
    expect(fetchCalls).toHaveLength(4)
    expect(fetchCalls[3]).toBe('/home/me/proj-a')

    // effect 释放（插件卸载）→ 停止响应 store 变化
    for (const disposer of disposers.splice(0).reverse()) disposer()
    sessions.set({ ids: ['b'], byId: { b: { id: 'b', cwd: '/b', retainedBy: { mainView: 1 } } } })
    expect(fetchCalls).toHaveLength(4)
  })
})
