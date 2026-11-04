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

import type { McpServerEntry, SkillEntry } from '../shared/protocol.ts'

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
