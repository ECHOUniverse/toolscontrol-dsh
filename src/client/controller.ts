/**
 * Public controller of the two read-only overview tabs.
 *
 * This is the framework-free seam between the wire snapshot and the React
 * views: the controller owns the overview fetch (same-origin), workspace and
 * main-session tracking over the official `sessions.list` /
 * `workspaces.list` stores, per-tab filters, explicit probe requests and
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
 * data (task red line). Probes are keyed by the Host-issued stable
 * `probeKey` — never by display name — so same-name entries in different
 * scopes can never overwrite each other. Every `load()`/`dispose()` aborts
 * all in-flight probe controllers and invalidates their generation; a late
 * probe result can never repopulate results that were already cleared.
 *
 * Probe discipline: only `requestProbe`/`requestProbeAll` ever call the
 * transport, and both are gated on `mcp.probe.available` plus the entry's
 * own `probeAvailable`/`enabled`/non-conditional flags. The snapshot fetch
 * never probes. Results are in-memory only (never persisted).
 *
 * Failure discipline: a failed refresh keeps the last good snapshot and
 * surfaces `error` + `stale`; only "failed AND nothing to show" is an error
 * empty state. Snapshot warnings always stay visible with partial data.
 *
 * @module @hanxu131/toolscontrol-dsh/client/controller
 */

import type {
  McpEntryScope,
  McpProbeResponse,
  McpProbeStage,
  McpServerEntry,
  OverviewSnapshot,
} from '../shared/protocol.ts'
import {
  DEFAULT_MCP_FILTERS,
  DEFAULT_SKILLS_FILTERS,
  collatorFor,
  countProbeTargets,
  filterMcpServers,
  filterSkillRows,
  groupSkills,
  isProbeRequestable,
  mcpStatusOptions,
  probeCapabilityAvailable,
  skillSourceOptions,
  isProbeTarget,
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
  /** Same-origin explicit `POST /toolscontrol/mcp/probe` keyed by `probeKey`. */
  probe(args: { probeKey: string; signal: AbortSignal }): Promise<McpProbeResponse>
  /** Official `sessions.list` store (optional: plain-environment fallback). */
  sessions?: ObservableStore<SessionsListShape>
  /** Official `workspaces.list` store (optional: plain-environment fallback). */
  workspaces?: ObservableStore<WorkspacesListShape>
  /** Clock for `lastRefreshedAt` (defaults to Date.now). */
  now?: () => number
}

/** A successful probe: the observation time, cost and tool names are kept. */
export interface ProbeSuccessState {
  probeKey: string
  phase: 'ok'
  probedAt: number
  durationMs: number
  toolNames: string[]
  toolCount: number
  scope?: McpEntryScope
  presetId?: string
  entryId?: string | null
}

/**
 * A failed probe. `message` is the Host's already-sanitized fixed text (kept
 * for diagnostics/tests); the views localize the stable `code` instead of
 * echoing raw errors. `transport` marks a client-side request failure where
 * no response existed at all — its `message` is deliberately empty so a
 * fetch error containing a URL can never reach the UI.
 */
export interface ProbeFailureState {
  probeKey: string
  phase: 'failed'
  stage: McpProbeStage
  code: McpProbeStage
  message: string
  durationMs: number
  scope?: McpEntryScope
  presetId?: string
  entryId?: string | null
  transport?: true
}

/** One explicit probe request's lifecycle (never automatic). */
export type ProbeState = { probeKey: string; phase: 'loading' } | ProbeSuccessState | ProbeFailureState

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
  /** Eligible entries in the CURRENT filtered rows (toolbar "probe all" count). */
  mcpProbeableCount: number
  skillsFilters: SkillsFilters
  skillRows: SkillRow[]
  skillSourceOptions: string[]
  /** Explicit probe results, keyed by the Host's stable `probeKey`. */
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
    mcpProbeableCount: 0,
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

/** Map a Host probe response onto the published probe state. */
function probeStateOf(answer: McpProbeResponse, requestedKey: string): ProbeState {
  if (answer.ok === true) {
    const toolNames = Array.isArray(answer.toolNames) ? answer.toolNames.map((name) => String(name)) : []
    return {
      probeKey: requestedKey,
      phase: 'ok',
      probedAt: typeof answer.probedAt === 'number' ? answer.probedAt : 0,
      durationMs: typeof answer.durationMs === 'number' ? answer.durationMs : 0,
      toolNames,
      toolCount: typeof answer.toolCount === 'number' ? answer.toolCount : toolNames.length,
      ...(answer.scope !== undefined ? { scope: answer.scope } : {}),
      ...(answer.presetId !== undefined ? { presetId: answer.presetId } : {}),
      entryId: answer.entryId,
    }
  }
  // Defensive runtime narrowing: an older/malformed Host must not crash the
  // view; the stable fallback code is still a safe, fixed classification.
  const raw = answer as { stage?: unknown; code?: unknown; message?: unknown; durationMs?: unknown; scope?: unknown; presetId?: unknown; entryId?: unknown }
  const code = typeof raw.code === 'string' ? (raw.code as McpProbeStage) : 'unavailable'
  const stage = typeof raw.stage === 'string' ? (raw.stage as McpProbeStage) : code
  return {
    probeKey: requestedKey,
    phase: 'failed',
    stage,
    code,
    message: typeof raw.message === 'string' ? raw.message : '',
    durationMs: typeof raw.durationMs === 'number' ? raw.durationMs : 0,
    ...(raw.scope !== undefined ? { scope: raw.scope as McpEntryScope } : {}),
    ...(raw.presetId !== undefined ? { presetId: String(raw.presetId) } : {}),
    ...(raw.entryId !== undefined ? { entryId: raw.entryId as string | null } : {}),
  }
}

export class ToolscontrolController {
  private readonly deps: ControllerDeps
  private readonly listeners = new Set<() => void>()
  private state: ClientState

  private attached = false
  private started = false
  private disposed = false
  private fetchSeq = 0
  /** Probe request generation PER probeKey: concurrent probes settle independently. */
  private readonly probeSeqs = new Map<string, number>()
  /** In-flight probe controllers, tracked per probeKey so dispose/load abort all. */
  private readonly probeControllers = new Map<string, AbortController>()
  /** Global probe generation: bumped whenever results are invalidated. */
  private probeEpoch = 0
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
   * The ONE explicit single-entry probe path.
   *
   * Gates, in order:
   * - the snapshot declares the independent probe capability
   *   (`mcp.probe.available === true`; `capabilities.probe` is deliberately
   *   NOT consulted — rc.5 keeps it false while this capability is on);
   * - a snapshot entry with this exact `probeKey` exists and is enabled,
   *   probe-available and not conditional;
   * - no probe for this `probeKey` is already loading (duplicate clicks are
   *   ignored, never queued).
   *
   * Nothing here runs after a snapshot fetch: probing is user-triggered only.
   */
  requestProbe(probeKey: string): void {
    if (this.disposed || typeof probeKey !== 'string' || probeKey === '') return
    const mcp = this.state.snapshot?.mcp
    if (!probeCapabilityAvailable(mcp)) return
    const entry = mcp?.servers.find((server) => server.probeKey === probeKey)
    if (entry === undefined || !isProbeTarget(entry, mcp)) return
    const current = this.state.probes[probeKey]
    if (current?.phase === 'loading') return

    const seq = (this.probeSeqs.get(probeKey) ?? 0) + 1
    this.probeSeqs.set(probeKey, seq)
    const epoch = this.probeEpoch
    const controller = new AbortController()
    this.probeControllers.set(probeKey, controller)
    this.publishProbe(probeKey, { probeKey, phase: 'loading' })
    void this.deps
      .probe({ probeKey, signal: controller.signal })
      .then((answer) => {
        if (this.disposed || this.probeEpoch !== epoch || this.probeSeqs.get(probeKey) !== seq || controller.signal.aborted) return
        this.probeControllers.delete(probeKey)
        this.publishProbe(probeKey, probeStateOf(answer, probeKey))
      })
      .catch(() => {
        // Never publish the raw fetch error (it can embed a URL/credential).
        if (this.disposed || this.probeEpoch !== epoch || this.probeSeqs.get(probeKey) !== seq || controller.signal.aborted) return
        this.probeControllers.delete(probeKey)
        this.publishProbe(probeKey, {
          probeKey,
          phase: 'failed',
          stage: 'unavailable',
          code: 'unavailable',
          message: '',
          durationMs: 0,
          transport: true,
        })
      })
  }

  /**
   * "Probe all" for the CURRENT filtered rows only (search/filter/sort
   * applied). Each eligible entry goes through the single-entry path, so the
   * per-key dedupe, gates and cancellation semantics are shared. Host-wide
   * concurrency (`mcp.probe.maxConcurrent`) is the Host's job: this method
   * starts one request per entry and never adds a client-side queue.
   */
  requestProbeAll(): void {
    if (this.disposed) return
    const mcp = this.state.snapshot?.mcp
    if (!probeCapabilityAvailable(mcp)) return
    for (const entry of this.state.mcpRows) {
      if (!isProbeRequestable(entry, mcp, this.state.probes)) continue
      this.requestProbe(entry.probeKey)
    }
  }

  dispose(): void {
    this.disposed = true
    this.abortCurrent?.abort()
    this.abortCurrent = null
    // Invalidate and abort EVERY in-flight probe: late settlements match no
    // generation and their controllers are cancelled.
    this.invalidateProbes()
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
   *
   * Probe results belong to the snapshot generation: starting a load aborts
   * every in-flight probe and invalidates its results; a successful load
   * clears the probe map. Filter changes do NOT pass through here, so they
   * keep probe results intact.
   */
  private async load(): Promise<void> {
    const seq = ++this.fetchSeq
    const controller = new AbortController()
    this.abortCurrent?.abort()
    this.abortCurrent = controller
    this.invalidateProbes()
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
      // A probe may have been started while the fetch was in flight; it
      // belongs to the OLD snapshot generation and must not survive.
      this.invalidateProbes()
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

  /** Abort every in-flight probe and invalidate its generation. */
  private invalidateProbes(): void {
    this.probeEpoch += 1
    this.probeSeqs.clear()
    for (const controller of this.probeControllers.values()) controller.abort()
    this.probeControllers.clear()
  }

  /** Recompute the derived views (filters, grouping, ordering) and publish. */
  private derive(): void {
    const { snapshot, mcpFilters, skillsFilters, language } = this.state
    const collator = collatorFor(language)
    const servers = snapshot?.mcp.servers ?? []
    const rows = groupSkills(snapshot?.skills.skills ?? [])
    const mcpRows = filterMcpServers(servers, mcpFilters, collator)
    this.state = {
      ...this.state,
      mcpRows,
      mcpStatusOptions: mcpStatusOptions(servers, collator),
      mcpProbeableCount: countProbeTargets(mcpRows, snapshot?.mcp, this.state.probes),
      skillRows: filterSkillRows(rows, skillsFilters, collator),
      skillSourceOptions: skillSourceOptions(rows, collator),
    }
    this.publish()
  }

  private publishProbe(probeKey: string, probe: ProbeState): void {
    this.state = { ...this.state, probes: { ...this.state.probes, [probeKey]: probe } }
    this.derive()
  }

  private publish(): void {
    for (const listener of [...this.listeners]) listener()
  }
}
