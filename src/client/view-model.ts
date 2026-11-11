/**
 * Pure view-model of the two read-only overview tabs (MCP / Skills).
 *
 * Everything here is data-in/data-out: no React, no fetches, no clock — so
 * the filtering, grouping, capability degradation and ordering rules are
 * testable in a plain node environment through the public functions only.
 *
 * Sorting is stable (spec: ES2019 `Array.prototype.sort`) and ordered by
 * `Intl.Collator` bound to the ACTIVE UI language, never by a fixed locale.
 *
 * Security posture: entries arrive from `shared/protocol.ts` wire types which
 * never carry env/headers/token material — this module cannot leak what it
 * never receives.
 *
 * @module @hanxu131/toolscontrol-dsh/client/view-model
 */

import type { McpServerEntry, McpSnapshot, SkillEntry } from '../shared/protocol.ts'
import type { WorkspaceContext } from './workspace.ts'

// ---------------------------------------------------------------------------
// Collator (slice: stable ordering by the active UI language)
// ---------------------------------------------------------------------------

/** Collator for one UI language tag (`zh` / `en`); any BCP-47 tag accepted. */
export function collatorFor(language: string): Intl.Collator {
  let tag = typeof language === 'string' && language.trim() !== '' ? language.trim() : 'en'
  if (!/^[a-zA-Z]{2,8}(-[a-zA-Z0-9]+)*$/.test(tag)) tag = 'en'
  return new Intl.Collator(tag)
}

// ---------------------------------------------------------------------------
// MCP filters (slice 1)
// ---------------------------------------------------------------------------

/** 启用状态筛选（默认只看已启用项）。 */
export type McpEnabledFilter = 'enabled' | 'disabled' | 'all'

/** 连接状态筛选：`all` 或某个连接状态值（rc.5 恒 `unknown`）。 */
export type McpStatusFilter = 'all' | (string & {})

/** MCP 列表筛选条件。 */
export interface McpFilters {
  /** 名称子串（不区分大小写；MCP 条目没有描述字段）。 */
  query: string
  enabled: McpEnabledFilter
  status: McpStatusFilter
}

/** 默认：无搜索词、只看已启用、不按状态筛。 */
export const DEFAULT_MCP_FILTERS: McpFilters = { query: '', enabled: 'enabled', status: 'all' }

/**
 * Filter + stable-sort MCP entries.
 *
 * rc.5 degradation is honoured upstream: the snapshot already pins every
 * status to `unknown`, so the status filter degenerates harmlessly.
 */
export function filterMcpServers(
  servers: readonly McpServerEntry[],
  filters: McpFilters,
  collator: Intl.Collator,
): McpServerEntry[] {
  const query = filters.query.trim().toLowerCase()
  return servers
    .filter((server) => filters.enabled === 'all' || (filters.enabled === 'enabled') === server.enabled)
    .filter((server) => filters.status === 'all' || server.status === filters.status)
    .filter((server) => query === '' || server.name.toLowerCase().includes(query))
    .slice()
    .sort((left, right) => collator.compare(left.name, right.name))
}

/** Distinct connection statuses present in the snapshot, collator-sorted. */
export function mcpStatusOptions(servers: readonly McpServerEntry[], collator: Intl.Collator): string[] {
  const seen = new Set<string>()
  for (const server of servers) seen.add(server.status)
  return [...seen].sort((left, right) => collator.compare(left, right))
}

/**
 * Empty-state message key of the MCP tab.
 *
 * A readable snapshot with zero servers means "the DSH profile root and its
 * composed presets declare no MCP server" — it must never read as "no MCP
 * anywhere", and it must not imply that external CLI configuration
 * (`~/.cursor`, `~/.kimi-code`, …) was read: this plugin only reads DSH's own
 * composition.
 *
 * That conclusion is only allowed when the snapshot explicitly says BOTH
 * composition surfaces were read completely (`mode === 'config'` with
 * `canAssertEmpty === true`). A partial read, an unavailable source, or the
 * managed mode (which governs only the global plane) cannot assert it, so the
 * neutral message is used and the warnings explain why. The test is on the
 * explicit capability flag, never on warning text.
 */
export function mcpEmptyStateKey(mcp: McpSnapshot | undefined): string {
  if (mcp === undefined || mcp.mode !== 'config' || mcp.canAssertEmpty !== true) return 'state.emptyAll'
  return 'mcp.emptyAll'
}

// ---------------------------------------------------------------------------
// Explicit MCP probe gating (slice: manual probe, keyed by `probeKey`)
// ---------------------------------------------------------------------------

/**
 * Probe availability of the snapshot.
 *
 * `mcp.probe` is a SEPARATE capability from `capabilities.probe`: rc.5 keeps
 * `capabilities.probe === false` while the independent Host probe can still
 * be available. A missing field means an older Host without the capability.
 */
export function probeCapabilityAvailable(mcp: McpSnapshot | undefined): boolean {
  return mcp?.probe?.available === true
}

/** Minimal entry shape needed by the probe gates (keeps the helpers testable). */
export interface ProbeTarget {
  probeKey: string
  enabled: boolean
  conditional?: true
  probeAvailable: boolean
}

/** Whether one entry may be probed at all (capability + entry gates). */
export function isProbeTarget(entry: ProbeTarget, mcp: McpSnapshot | undefined): boolean {
  if (!probeCapabilityAvailable(mcp)) return false
  if (entry.probeAvailable !== true) return false
  if (entry.enabled !== true) return false
  if (entry.conditional === true) return false
  return true
}

/** Probe lifecycle subset the view-model needs (never the result payload). */
export interface ProbePhaseLike {
  phase: string
}

/**
 * Whether a probe may be STARTED right now: the entry passes every gate and
 * is not already loading. Batch probing skips loading entries (a repeated
 * click must never duplicate a request).
 */
export function isProbeRequestable(
  entry: ProbeTarget,
  mcp: McpSnapshot | undefined,
  probes: Readonly<Record<string, ProbePhaseLike>>,
): boolean {
  if (!isProbeTarget(entry, mcp)) return false
  return probes[entry.probeKey]?.phase !== 'loading'
}

/**
 * Count the entries of the CURRENT filtered rows that a "probe all" action
 * would request. Disabled, not-probeable, conditional and already-loading
 * entries are excluded, so the toolbar label always matches what is sent.
 */
export function countProbeTargets(
  rows: readonly ProbeTarget[],
  mcp: McpSnapshot | undefined,
  probes: Readonly<Record<string, ProbePhaseLike>>,
): number {
  let count = 0
  for (const row of rows) if (isProbeRequestable(row, mcp, probes)) count += 1
  return count
}

// ---------------------------------------------------------------------------
// Skills scope line (session scope vs. workspace directory)
// ---------------------------------------------------------------------------

/**
 * The Skills tab's top scope line. It distinguishes three genuinely different
 * situations that must never share copy:
 * - a workspace/title is known → show it;
 * - a main session is known but its cwd is not → session preset scope applies,
 *   the project directory is unknown (must NOT read as "global skills");
 * - neither is known → global view with an unknown project directory.
 */
export type SkillsScopeLine =
  | { key: 'workspace.title'; title: string }
  | { key: 'workspace.sessionNoCwd'; sessionId: string }
  | { key: 'workspace.none' }

/** Resolve the Skills scope line from the published workspace context. */
export function skillsScopeLine(workspace: WorkspaceContext): SkillsScopeLine {
  const title = workspace.workspaceTitle ?? workspace.cwd
  if (title !== null && title !== undefined && title !== '') return { key: 'workspace.title', title }
  if (workspace.sessionId !== null && workspace.sessionId !== '') {
    return { key: 'workspace.sessionNoCwd', sessionId: workspace.sessionId }
  }
  return { key: 'workspace.none' }
}

// ---------------------------------------------------------------------------
// Skills grouping + filters (slice 2)
// ---------------------------------------------------------------------------

/** 调用策略筛选：按生效项的官方注册表策略。 */
export type SkillInvocationFilter = 'all' | 'user' | 'model' | 'none'

/** Skills 列表筛选条件（source 为具体来源标签或 `all`）。 */
export interface SkillsFilters {
  /** 名称/描述/whenToUse 子串（不区分大小写；只作用于生效项）。 */
  query: string
  source: 'all' | (string & {})
  invocation: SkillInvocationFilter
}

/** 默认：无搜索词、不按来源筛、不按调用策略筛。 */
export const DEFAULT_SKILLS_FILTERS: SkillsFilters = { query: '', source: 'all', invocation: 'all' }

/**
 * One main-list row: the effective entry plus every same-name shadowed
 * version (shown ONLY inside the row's inline detail, never as main rows).
 *
 * `effective` is null for the defensive edge of an all-shadowed group (the
 * Host registry always ships a winner; the type keeps such data visible
 * instead of silently dropping it).
 */
export interface SkillRow {
  effective: SkillEntry | null
  shadowed: SkillEntry[]
}

/** The row's representative entry (search/filter/sort key; never undefined). */
function primaryOf(row: SkillRow): SkillEntry {
  return row.effective ?? row.shadowed[0]!
}

/**
 * Group a snapshot's skill list into main rows: effective entries in snapshot
 * order, each carrying its same-name shadowed versions. Shadowed entries are
 * never projected as independent main rows.
 */
export function groupSkills(skills: readonly SkillEntry[]): SkillRow[] {
  const byName = new Map<string, SkillRow>()
  for (const skill of skills) {
    const existing = byName.get(skill.name)
    if (skill.visibility === 'effective') {
      if (existing === undefined) {
        byName.set(skill.name, { effective: skill, shadowed: [] })
      } else if (existing.effective === null) {
        // Defensive: a winner arrived after its shadowed versions were seen.
        byName.set(skill.name, { effective: skill, shadowed: existing.shadowed })
      }
      // Duplicate effective entries are NOT expected: the official `ctx.skills`
      // registry yields exactly ONE winner per name (the Host takes the
      // registry winner as-is and never substitutes its own). Keeping the
      // first is pure defense against a malformed snapshot — it encodes no
      // real priority rule.
    } else if (existing !== undefined) {
      existing.shadowed.push(skill)
    } else {
      byName.set(skill.name, { effective: null, shadowed: [skill] })
    }
  }
  return [...byName.values()]
}

function skillMatchesQuery(entry: SkillEntry, query: string): boolean {
  return (
    entry.name.toLowerCase().includes(query) ||
    entry.description.toLowerCase().includes(query) ||
    (entry.whenToUse !== undefined && entry.whenToUse.toLowerCase().includes(query))
  )
}

/**
 * Filter + stable-sort main rows. Search, source and invocation filters read
 * ONLY the representative (effective) entry — a shadowed version can never
 * surface an independent row.
 */
export function filterSkillRows(
  rows: readonly SkillRow[],
  filters: SkillsFilters,
  collator: Intl.Collator,
): SkillRow[] {
  const query = filters.query.trim().toLowerCase()
  return rows
    .filter((row) => {
      const primary = primaryOf(row)
      if (filters.source !== 'all' && primary.source !== filters.source) return false
      if (filters.invocation !== 'all') {
        if (row.effective === null) return false
        const { modelInvocable, userInvocable } = row.effective.invocation
        if (filters.invocation === 'user' && !userInvocable) return false
        if (filters.invocation === 'model' && !modelInvocable) return false
        if (filters.invocation === 'none' && (modelInvocable || userInvocable)) return false
      }
      if (query !== '' && !skillMatchesQuery(primary, query)) return false
      return true
    })
    .slice()
    .sort((left, right) => collator.compare(primaryOf(left).name, primaryOf(right).name))
}

/** Distinct source labels across rows (representative entries), collator-sorted. */
export function skillSourceOptions(rows: readonly SkillRow[], collator: Intl.Collator): string[] {
  const seen = new Set<string>()
  for (const row of rows) seen.add(primaryOf(row).source)
  return [...seen].sort((left, right) => collator.compare(left, right))
}
