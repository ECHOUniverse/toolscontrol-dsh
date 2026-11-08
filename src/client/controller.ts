/**
 * Public controller of the two read-only overview tabs.
 *
 * This is the framework-free seam between the wire snapshot and the React
 * views: the controller owns the overview fetch (same-origin), workspace and
 * main-session tracking over the official `sessions.list` /
 * `workspaces.list` stores, per-tab filters, probe requests and
 * language-dependent ordering. React binds it through `getSnapshot` /
 * `subscribe` (useSyncExternalStore).
 *
 * The request carries both `cwd` (project discovery context) and `sessionId`
 * (the live session whose preset scope holds its Skills); the host must use
 * the session scope, not cwd alone.
 *
 * Race discipline: every fetch/probe runs under a monotonic sequence number
 * and its own AbortSignal; a late settlement of a superseded request is
 * dropped, so an old workspace's snapshot can never overwrite the new cwd's
 * data (task red line).
 *
 * Failure discipline: a failed refresh keeps the last good snapshot and
 * surfaces `error` + `stale`; only "failed AND nothing to show" is an error
 * empty state. Snapshot warnings always stay visible with partial data.
 *
 * @module @hanxu131/toolscontrol-dsh/client/controller
 */

import type { McpServerEntry, McpProbeResponse, OverviewSnapshot } from '../shared/protocol.ts'
import {
  DEFAULT_MCP_FILTERS,
  DEFAULT_SKILLS_FILTERS,
  collatorFor,
  filterMcpServers,
  filterSkillRows,
  groupSkills,
  mcpStatusOptions,
  skillSourceOptions,
  type McpFilters,
  type SkillRow,
  type SkillsFilters,
} from './view-model.ts'
import { NO_WORKSPACE, resolveWorkspaceContext, type WorkspaceContext, type SessionsListShape, type WorkspacesListShape } from './workspace.ts'

/** Minimal observable face of the official list stores (getSnapshot/subscribe). */
export interface ObservableStore<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

/** Injected dependencies — all swappable for tests. */
export interface ControllerDeps {
  /** Same-origin `GET /toolscontrol/overview?cwd=…&sessionId=…` with cancellation. */
  fetchOverview(args: { cwd?: string; sessionId?: string; signal: AbortSignal }): Promise<OverviewSnapshot>
  /** Same-origin explicit `POST /toolscontrol/mcp/probe`. */
  probe(args: { server: string; signal: AbortSignal }): Promise<McpProbeResponse>
  /** Official `sessions.list` store (optional: plain-environment fallback). */
  sessions?: ObservableStore<SessionsListShape>
  /** Official `workspaces.list` store (optional: plain-environment fallback). */
  workspaces?: ObservableStore<WorkspacesListShape>
  /** Clock for `lastRefreshedAt` (defaults to Date.now). */
  now?: () => number
}

/** One explicit probe request's lifecycle (never automatic). */
export type ProbeState =
  | { server: string; phase: 'loading' }
  | { server: string; phase: 'ok'; toolNames: string[] }
  | { server: string; phase: 'failed'; message: string }

/** Whole published state: one frozen object, stable reference until change. */
export interface ClientState {
  language: string
  workspace: WorkspaceContext
  /** Convenience alias of `workspace.cwd` (the `?cwd=` fetch argument). */
  cwd: string | null
  status: 'idle' | 'loading' | 'ready' | 'error'
  /** Last GOOD snapshot; retained across a failed refresh. */
  snapshot: OverviewSnapshot | null
  /** Last failure message (null after a success). */
  error: string | null
  /** True when `snapshot` is shown alongside a refresh failure. */
  stale: boolean
  /** Epoch ms of the last successful snapshot, or null. */
  lastRefreshedAt: number | null
  mcpFilters: McpFilters
  mcpRows: McpServerEntry[]
  mcpStatusOptions: string[]
  skillsFilters: SkillsFilters
  skillRows: SkillRow[]
  skillSourceOptions: string[]
  probes: Readonly<Record<string, ProbeState>>
}

/** Initial public state (before the first `ensure()`). */
function initialState(language: string): ClientState {
  return {
    language,
    workspace: NO_WORKSPACE,
    cwd: null,
    status: 'idle',
    snapshot: null,
    error: null,
    stale: false,
    lastRefreshedAt: null,
    mcpFilters: { ...DEFAULT_MCP_FILTERS },
    mcpRows: [],
    mcpStatusOptions: [],
    skillsFilters: { ...DEFAULT_SKILLS_FILTERS },
    skillRows: [],
    skillSourceOptions: [],
    probes: {},
  }
}

/** Readable message of any thrown value (never credential material). */
function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message !== '') return error.message
  return String(error)
}

export class ToolscontrolController {
  private readonly deps: ControllerDeps
  private readonly listeners = new Set<() => void>()
  private state: ClientState

  private attached = false
  private started = false
  private disposed = false
  private fetchSeq = 0
  /** Probe request generation PER SERVER: concurrent probes settle independently. */
  private readonly probeSeqs = new Map<string, number>()
  private abortCurrent: AbortController | null = null
  private readonly detachStores: (() => void)[] = []

  constructor(deps: ControllerDeps) {
    this.deps = deps
    this.state = initialState('en')
  }

  // ------------------------------------------------------------- public seam

  /** Bound so React's useSyncExternalStore can take the reference directly. */
  getSnapshot = (): ClientState => {
    return this.state
  }

  /** Bound for the same reason; returns the unsubscribe function. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * Enter-the-tab seam: the FIRST call attaches the workspace-store
   * subscriptions (exactly once) and runs the initial fetch; every later call
   * — re-entering the tab remounts the section — re-fetches in place, so the
   * view always shows a fresh snapshot. Store notifications still re-fetch
   * ONLY when `cwd` or the main session's `sessionId` actually changed (the
   * session's preset scope selects different Skills even under one cwd).
   */
  ensure(): void {
    if (this.disposed) return
    if (this.started) {
      void this.load()
      return
    }
    this.started = true
    this.attachStores()
    void this.load()
  }

  /** Manual refresh: aborts any in-flight fetch and re-requests the current workspace/session context. */
  refresh(): void {
    if (this.disposed) return
    void this.load()
  }

  /**
   * Config-invalidation nudge (official `plugin-manager/changed` event or a
   * future `mcpManager.watch`): re-fetch when data is already on screen. A
   * tab that was never opened stays untouched.
   */
  invalidate(): void {
    if (this.disposed || this.state.snapshot === null) return
    void this.load()
  }

  setMcpFilters(patch: Partial<McpFilters>): void {
    this.state = { ...this.state, mcpFilters: { ...this.state.mcpFilters, ...patch } }
    this.derive()
  }

  setSkillsFilters(patch: Partial<SkillsFilters>): void {
    this.state = { ...this.state, skillsFilters: { ...this.state.skillsFilters, ...patch } }
    this.derive()
  }

  /** Switch UI language: rebinds the collator and re-derives sorted rows. */
  setLanguage(language: string): void {
    this.state = { ...this.state, language }
    this.derive()
  }

  /**
   * The ONE explicit probe path. Gated on the snapshot's own capability: when
   * `capabilities.probe` is false (rc.5) this never issues a request. While a
   * probe for a server is loading, further triggers are ignored.
   */
  requestProbe(server: string): void {
    if (this.disposed || server === '') return
    if (this.state.snapshot?.mcp.capabilities.probe !== true) return
    const current = this.state.probes[server]
    if (current?.phase === 'loading') return
    const seq = (this.probeSeqs.get(server) ?? 0) + 1
    this.probeSeqs.set(server, seq)
    const controller = new AbortController()
    this.publishProbe(server, { server, phase: 'loading' })
    void this.deps
      .probe({ server, signal: controller.signal })
      .then((answer) => {
        if (this.disposed || this.probeSeqs.get(server) !== seq) return
        if (answer.ok) {
          this.publishProbe(server, { server, phase: 'ok', toolNames: [...answer.toolNames] })
        } else {
          this.publishProbe(server, { server, phase: 'failed', message: answer.message })
        }
      })
      .catch((error: unknown) => {
        if (this.disposed || this.probeSeqs.get(server) !== seq || controller.signal.aborted) return
        this.publishProbe(server, { server, phase: 'failed', message: errorMessage(error) })
      })
  }

  dispose(): void {
    this.disposed = true
    this.abortCurrent?.abort()
    this.abortCurrent = null
    // Invalidate EVERY in-flight probe: late settlements match no generation.
    this.probeSeqs.clear()
    for (const detach of this.detachStores.splice(0)) detach()
    this.listeners.clear()
  }

  // ---------------------------------------------------------------- internals

  private attachStores(): void {
    if (this.attached) return
    this.attached = true
    const { sessions, workspaces } = this.deps
    if (sessions !== undefined) {
      this.detachStores.push(sessions.subscribe(() => this.onStoresChanged()))
    }
    if (workspaces !== undefined) {
      this.detachStores.push(workspaces.subscribe(() => this.onStoresChanged()))
    }
    this.applyWorkspace(resolveWorkspaceContext(sessions?.getSnapshot(), workspaces?.getSnapshot()))
  }

  private onStoresChanged(): void {
    if (this.disposed) return
    const next = resolveWorkspaceContext(this.deps.sessions?.getSnapshot(), this.deps.workspaces?.getSnapshot())
    const previousCwd = this.state.workspace.cwd
    const previousSessionId = this.state.workspace.sessionId
    this.applyWorkspace(next)
    // 同一 cwd 下也可能切换到另一主 Session：会话级 preset scope 可能不同，
    // 因此 sessionId 变化同样必须重新获取。
    if (next.cwd !== previousCwd || next.sessionId !== previousSessionId) void this.load()
  }

  /** Publish the resolved workspace even when cwd is unchanged (title etc.). */
  private applyWorkspace(workspace: WorkspaceContext): void {
    this.state = { ...this.state, workspace, cwd: workspace.cwd }
    this.derive()
  }

  /**
   * One fetch generation. A newer `load()` bumps `fetchSeq` and aborts the
   * previous signal; any late settlement of a superseded generation is dropped
   * before it can touch published state.
   */
  private async load(): Promise<void> {
    const seq = ++this.fetchSeq
    const controller = new AbortController()
    this.abortCurrent?.abort()
    this.abortCurrent = controller
    const { cwd, sessionId } = this.state.workspace
    this.state = { ...this.state, status: 'loading' }
    this.derive()
    try {
      const snapshot = await this.deps.fetchOverview({
        ...(cwd !== null ? { cwd } : {}),
        ...(sessionId !== null ? { sessionId } : {}),
        signal: controller.signal,
      })
      if (this.disposed || seq !== this.fetchSeq) return
      this.state = {
        ...this.state,
        status: 'ready',
        snapshot,
        error: null,
        stale: false,
        lastRefreshedAt: (this.deps.now ?? Date.now)(),
        probes: {},
      }
      this.derive()
    } catch (error) {
      if (this.disposed || seq !== this.fetchSeq || controller.signal.aborted) return
      const message = errorMessage(error)
      // Keep partial data: a failed refresh never blanks the previous snapshot.
      this.state = {
        ...this.state,
        status: this.state.snapshot === null ? 'error' : 'ready',
        error: message,
        stale: this.state.snapshot !== null,
      }
      this.derive()
    }
  }

  /** Recompute the derived views (filters, grouping, ordering) and publish. */
  private derive(): void {
    const { snapshot, mcpFilters, skillsFilters, language } = this.state
    const collator = collatorFor(language)
    const servers = snapshot?.mcp.servers ?? []
    const rows = groupSkills(snapshot?.skills.skills ?? [])
    this.state = {
      ...this.state,
      mcpRows: filterMcpServers(servers, mcpFilters, collator),
      mcpStatusOptions: mcpStatusOptions(servers, collator),
      skillRows: filterSkillRows(rows, skillsFilters, collator),
      skillSourceOptions: skillSourceOptions(rows, collator),
    }
    this.publish()
  }

  private publishProbe(server: string, probe: ProbeState): void {
    this.state = { ...this.state, probes: { ...this.state.probes, [server]: probe } }
    this.publish()
  }

  private publish(): void {
    for (const listener of [...this.listeners]) listener()
  }
}
