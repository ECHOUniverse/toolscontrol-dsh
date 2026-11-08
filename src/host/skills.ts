/**
 * Skills 只读聚合（CONTEXT.md「Skills」）。
 *
 * 生效项始终来自官方 `ctx.skills` 注册表（赢家为主，插件不自行替换）。
 * 请求携带 sessionId 时按官方 `sessionSkillCatalog` 的链路读取：
 * `agents.get(sessionId)` → live Agent（同时作为 scope）→
 * `agentPresets.serviceFor(live, 'skills') ?? ctx.skills` →
 * `registry.list({ cwd, scope: live })`。当前 DSH 的 skill-filesystem
 * 注册在会话 preset scope，只用 cwd 会漏掉会话实际的 Skills。没有 live
 * Agent 时回退旧的全局读取并给出诚实 warning。注册表缺失或读取失败 →
 * 单来源降级 + warning，快照不整体失败。
 *
 * 同名被遮蔽版本由只读文件扫描补充（官方已确认的 Skills 根目录）：
 * 目录包 `<root>/<name>/SKILL.md`、平铺 `<root>/<name>.md`，不递归嵌套。
 * frontmatter 解析遵循官方 skill-filesystem 规则（`---` YAML、name 必须为
 * kebab-case、`disable-model-invocation`/`user-invocable` 布尔、legacy 键
 * 拒绝）；malformed 条目单条 warning 并跳过。文件缺失静默，其余读取失败
 * 单来源 warning——都不让快照失败。
 *
 * 枚举限制（必须入 DTO warning）：运行时、preset 与自定义目录来源的
 * 竞争版本不可完整枚举——可见的被遮蔽版本只是文件来源能看到的子集。
 * 无同名生效项的文件条目保守不列入（其生效性无法确认）。
 *
 * 安全红线：只读；绝不写任何 Skill 文件或 MCP 配置。
 *
 * @module @hanxu131/toolscontrol-dsh/host/skills
 */

import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parse } from 'yaml'
import type { SkillEntry, SkillInvocationPolicy, SkillsSnapshot } from '../shared/protocol.ts'
import { errorMessage } from './services.ts'
import type { AgentFace, AgentPresetsFace, AgentsFace, SkillSummaryFace, SkillsRegistryFace } from './services.ts'
import { warn, warningLog, type WarningLog } from './warnings.ts'

/**
 * 来源优先级（官方 skill-filesystem rc.5 常量：低者胜；runtime 注册夹在
 * project 与 custom 之间）。未知来源无 rank —— 不做被遮蔽判定，保守标警告。
 */
export const SKILL_SOURCE_RANK: Record<string, number> = {
  'project-dsh': 100,
  'project-agents': 200,
  runtime: 250,
  custom: 300,
  'user-dsh': 400,
  'user-agents': 500,
  bundled: 600,
}

/** 官方技能名文法（dsh-skill rc.5 `SKILL_NAME`）。 */
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** 晚绑定注入的服务集合。 */
export interface SkillCatalogServices {
  registry?: SkillsRegistryFace
  /** `ctx.agents`：把请求的 sessionId 映射到 live Agent（也是会话 scope）。 */
  agents?: AgentsFace
  /** `ctx.agentPresets`：解析会话 preset 组合内挂载的 skills 服务。 */
  presets?: AgentPresetsFace
}

/** 用户根目录覆盖（默认 `$DSH_HOME`/`~/.dsh`、`$DSH_AGENTS_HOME`/`~/.agents`）。 */
export interface SkillCatalogRoots {
  dshHome?: string
  agentsHome?: string
}

export interface SkillCatalogOptions extends SkillCatalogServices {
  roots?: SkillCatalogRoots
}

/** 一个已确认的只读扫描根（官方 skill-filesystem 的默认根布局）。 */
interface ScanRoot {
  path: string
  source: string
  rank: number
}

/** frontmatter 解析结果：合法条目或单条失败原因。 */
type ParsedSkill =
  | { ok: true; name: string; description: string; whenToUse?: string; invocation: SkillInvocationPolicy }
  | { ok: false; reason: string }

/** 只读 Skills 目录：生效项 + 同名被遮蔽项。 */
export class SkillCatalog {
  private registry: SkillsRegistryFace | undefined
  private agents: AgentsFace | undefined
  private presets: AgentPresetsFace | undefined
  private readonly roots: SkillCatalogRoots

  constructor(options: SkillCatalogOptions = {}) {
    this.registry = options.registry
    this.agents = options.agents
    this.presets = options.presets
    this.roots = options.roots ?? {}
  }

  /** 晚绑定：对应 `ctx.inject` effect 触发时挂上服务。 */
  attachServices(services: SkillCatalogServices): void {
    if (services.registry !== undefined) this.registry = services.registry
    if (services.agents !== undefined) this.agents = services.agents
    if (services.presets !== undefined) this.presets = services.presets
  }

  /** 晚绑定：服务 cycle/卸载时摘除。 */
  detachServices(names: readonly ('registry' | 'agents' | 'presets')[]): void {
    for (const name of names) {
      if (name === 'registry') this.registry = undefined
      if (name === 'agents') this.agents = undefined
      if (name === 'presets') this.presets = undefined
    }
  }

  /**
   * 当前可见 Skills 快照：生效项 + 同名被遮蔽项（文件来源可见的子集）。
   * 单来源失败只产生 warning，快照不整体失败。
   *
   * `sessionId` 存在时按官方 `sessionSkillCatalog` 的链路读取：
   * `agents.get(sessionId)` → live Agent（同时作为 scope）→
   * `agentPresets.serviceFor(live, 'skills') ?? ctx.skills` →
   * `registry.list({ cwd, scope: live })`。没有 live Agent（或没有
   * agents 服务）时回退旧的全局读取，并给出诚实 warning。
   */
  async snapshot(cwd?: string, sessionId?: string): Promise<SkillsSnapshot> {
    const scopeWarnings = warningLog()
    const target = this.resolveListTarget(cwd, sessionId, scopeWarnings)
    if (target === undefined) {
      warn(scopeWarnings, 'skills.unavailable', undefined, 'skills 服务不可用：生效 Skill 无法枚举')
      return {
        cwd: cwd ?? null,
        skills: [],
        warnings: scopeWarnings.warnings,
        warningItems: scopeWarnings.warningItems,
      }
    }
    let effective: readonly SkillSummaryFace[]
    try {
      effective = await target.registry.list(target.options)
    } catch (error) {
      warn(scopeWarnings, 'skills.registryFailed', { message: errorMessage(error) }, `skills 注册表读取失败：${errorMessage(error)}`)
      return {
        cwd: cwd ?? null,
        skills: [],
        warnings: scopeWarnings.warnings,
        warningItems: scopeWarnings.warningItems,
      }
    }
    const { entries, warnings } = await this.aggregate(effective, cwd)
    return {
      cwd: cwd ?? null,
      skills: entries,
      warnings: [...scopeWarnings.warnings, ...warnings.warnings],
      warningItems: [...scopeWarnings.warningItems, ...warnings.warningItems],
    }
  }

  /**
   * 解析本次读取应使用的注册表与 `list` 选项。
   *
   * 官方会话链路是 `agents.get(sessionId)` → live Agent（scope carrier）→
   * `agentPresets.serviceFor(live, 'skills') ?? ctx.skills`。因此宿主
   * registry 缺失时，只要 live 会话能解析出 preset 专属 skills 注册表，
   * 仍可读取会话 Skills；只有宿主与 preset 都不可用才报不可用。
   * 没有 live Agent（或没有 agents 服务）时保留旧的全局读取 + warning。
   */
  private resolveListTarget(
    cwd: string | undefined,
    sessionId: string | undefined,
    warnings: WarningLog,
  ): { registry: SkillsRegistryFace; options: { cwd?: string; scope?: object } } | undefined {
    const options: { cwd?: string; scope?: object } = cwd !== undefined ? { cwd } : {}
    if (sessionId === undefined || sessionId === '') {
      // 未选择会话：全局视图是唯一可靠范围（UI 已明确标注“全局 Skills”）。
      return this.registry !== undefined ? { registry: this.registry, options } : undefined
    }
    const live = this.liveAgent(sessionId, warnings)
    if (live === undefined) {
      // 兼容旧行为，但绝不把全局/文件扫描结果伪装成该会话的生效项。
      return this.registry !== undefined ? { registry: this.registry, options } : undefined
    }
    const preset = this.presetRegistry(live, warnings)
    const registry = preset ?? this.registry
    if (registry === undefined) return undefined
    return { registry, options: { ...options, scope: live } }
  }

  /** 官方 `agents.get(sessionId)`；服务缺失/查询失败/无 live 均降级为全局 + warning。 */
  private liveAgent(sessionId: string, warnings: WarningLog): AgentFace | undefined {
    const agents = this.agents
    if (agents === undefined) {
      warn(
        warnings,
        'skills.agentsUnavailable',
        { sessionId },
        `agents 服务不可用：无法确认会话 ${sessionId} 的 preset 范围，仅展示全局注册表`,
      )
      return undefined
    }
    try {
      const live = agents.get(sessionId)
      if (live === undefined) {
        warn(
          warnings,
          'skills.sessionNoAgent',
          { sessionId },
          `会话 ${sessionId} 没有运行中的 Agent：无法读取该会话 preset 范围内的 Skills，仅展示全局注册表`,
        )
      }
      return live
    } catch (error) {
      warn(
        warnings,
        'skills.sessionAgentFailed',
        { sessionId, message: errorMessage(error) },
        `会话 ${sessionId} 的 Agent 查询失败：${errorMessage(error)}；仅展示全局注册表`,
      )
      return undefined
    }
  }

  /** 官方同源回退：preset 专属 skills 服务优先；缺失/解析失败返回 undefined 交由宿主兜底。 */
  private presetRegistry(live: AgentFace, warnings: WarningLog): SkillsRegistryFace | undefined {
    const presets = this.presets
    if (presets === undefined) return undefined
    try {
      return presets.serviceFor(live, 'skills') ?? undefined
    } catch (error) {
      const message = errorMessage(error)
      if (this.registry !== undefined) {
        warn(
          warnings,
          'skills.presetFailedFallback',
          { message },
          `preset 专属 skills 服务解析失败：${message}；改用宿主 skills 注册表（仍带会话 scope）`,
        )
      } else {
        warn(warnings, 'skills.presetFailed', { message }, `preset 专属 skills 服务解析失败：${message}`)
      }
      return undefined
    }
  }

  /** 生效项 + 被遮蔽项合并与全部 warning 的产生。 */
  private async aggregate(effective: readonly SkillSummaryFace[], cwd?: string): Promise<{
    entries: SkillEntry[]
    warnings: WarningLog
  }> {
    // 常驻枚举限制（CONTEXT.md「被遮蔽 Skill」）：任何非 bundled 赢家都
    // 可能有更高 rank 的运行时/preset/自定义目录竞争版本，文件扫描不可见。
    const warnings = warningLog()
    warn(
      warnings,
      'skills.shadowedIncomplete',
      undefined,
      '同名被遮蔽版本不保证完整：运行时、preset 与自定义目录来源的竞争版本不可完整枚举',
    )
    const winners = new Map<string, { summary: SkillSummaryFace; rank: number | undefined }>()
    for (const summary of effective) {
      winners.set(summary.name, { summary, rank: SKILL_SOURCE_RANK[summary.source] })
    }

    const shadowed = await this.scanShadowed(cwd, winners, warnings)
    const entries = effective.map(toEffectiveEntry)
    entries.push(...shadowed)
    entries.sort((a, b) => (a.name.localeCompare(b.name) || (a.visibility === 'effective' ? -1 : 1)))
    return { entries, warnings }
  }

  /** 只读扫描已确认根目录，为每个同名赢家补全部被遮蔽版本（详情可见）。 */
  private async scanShadowed(
    cwd: string | undefined,
    winners: Map<string, { summary: SkillSummaryFace; rank: number | undefined }>,
    warnings: WarningLog,
  ): Promise<SkillEntry[]> {
    const shadowed: SkillEntry[] = []
    for (const root of this.scanRoots(cwd)) {
      for (const path of await listRootCandidateFiles(root, warnings)) {
        const parsed = await this.readSkillFile(path, warnings)
        if (parsed === undefined || !parsed.ok) continue
        // 官方以 frontmatter 的 name 为准（目录名只是发现提示）。
        // 不做同名去重：不同来源/根的同名被遮蔽版本全部列出（详情可见），
        // 官方赢家始终为主，不受扫描影响。
        const winner = winners.get(parsed.name)
        if (winner === undefined) continue
        const winnerPath = winner.summary.path
        if (winnerPath !== undefined && winnerPath === path) continue
        const winnerRank = winner.rank
        if (winnerRank === undefined || root.rank <= winnerRank) {
          // 文件来源优先级不高于生效版本（或生效来源未知）：不判遮蔽。
          warn(
            warnings,
            'skills.priorityUnconfirmed',
            { name: parsed.name, source: root.source, winnerSource: winner.summary.source },
            `文件来源 ${parsed.name}（${root.source}）与生效版本（${winner.summary.source}）的优先级关系无法确认，未判遮蔽`,
          )
          continue
        }
        shadowed.push({
          name: parsed.name,
          description: parsed.description,
          ...(parsed.whenToUse !== undefined ? { whenToUse: parsed.whenToUse } : {}),
          source: root.source,
          invocation: parsed.invocation,
          visibility: 'shadowed',
          shadowedBy: winner.summary.source,
          path,
        })
      }
    }
    return shadowed
  }

  /**
   * 已确认的只读扫描根（官方 skill-filesystem rc.5 的默认根布局）：
   * project-dsh/project-agents 随请求 cwd，user-dsh/user-agents 来自
   * `$DSH_HOME`/`$DSH_AGENTS_HOME` 或用户主目录。运行时、custom 与
   * bundled 根不可确认（custom 根由官方配置决定），不在此扫描。
   */
  private scanRoots(cwd: string | undefined): ScanRoot[] {
    const roots: ScanRoot[] = []
    if (cwd !== undefined && cwd !== '') {
      roots.push({ path: join(cwd, '.dsh', 'skills'), source: 'project-dsh', rank: SKILL_SOURCE_RANK['project-dsh']! })
      roots.push({ path: join(cwd, '.agents', 'skills'), source: 'project-agents', rank: SKILL_SOURCE_RANK['project-agents']! })
    }
    const dshHome = this.roots.dshHome ?? process.env['DSH_HOME'] ?? join(homedir(), '.dsh')
    const agentsHome = this.roots.agentsHome ?? process.env['DSH_AGENTS_HOME'] ?? join(homedir(), '.agents')
    roots.push({ path: join(dshHome, 'skills'), source: 'user-dsh', rank: SKILL_SOURCE_RANK['user-dsh']! })
    roots.push({ path: join(agentsHome, 'skills'), source: 'user-agents', rank: SKILL_SOURCE_RANK['user-agents']! })
    // 同一路径只扫一次（首个来源生效）；生产中两类用户根不同目录。
    const seen = new Set<string>()
    return roots.filter((root) => {
      if (seen.has(root.path)) return false
      seen.add(root.path)
      return true
    })
  }

  /**
   * 读取并解析一个指令文件。文件缺失 → undefined（静默，目录包未完成
   * 属正常）；其余读取失败 → 单条 warning；解析失败 → 单条 warning。
   */
  private async readSkillFile(path: string, warnings: WarningLog): Promise<ParsedSkill | undefined> {
    let raw: string
    try {
      raw = await readFile(path, 'utf8')
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code
      if (code === 'ENOENT') return undefined
      warn(
        warnings,
        'skills.fileReadFailed',
        { path, message: errorMessage(error) },
        `skill 文件 ${path} 读取失败：${errorMessage(error)}`,
      )
      return undefined
    }
    const parsed = parseSkillFrontmatter(raw)
    if (!parsed.ok) {
      warn(warnings, 'skills.fileIgnored', { path, reason: parsed.reason }, `skill 文件 ${path} 被忽略：${parsed.reason}`)
      return parsed
    }
    return parsed
  }
}

/** 列举一个扫描根的候选文件：`<root>/<name>/SKILL.md` 与 `<root>/<name>.md`。 */
async function listRootCandidateFiles(root: ScanRoot, warnings: WarningLog): Promise<string[]> {
  let dirents
  try {
    dirents = await readdir(root.path, { withFileTypes: true })
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code
    if (code === 'ENOENT') return []
    warn(
      warnings,
      'skills.rootReadFailed',
      { path: root.path, message: errorMessage(error) },
      `skill 根目录 ${root.path} 读取失败：${errorMessage(error)}`,
    )
    return []
  }
  const paths: string[] = []
  for (const dirent of dirents.sort((a, b) => a.name.localeCompare(b.name))) {
    if (dirent.isDirectory()) {
      paths.push(join(root.path, dirent.name, 'SKILL.md'))
    } else if (dirent.isFile() && dirent.name.endsWith('.md')) {
      paths.push(join(root.path, dirent.name))
    }
  }
  return paths
}

/** 官方生效摘要 → wire 条目（缺省字段不产出键）。 */
function toEffectiveEntry(summary: SkillSummaryFace): SkillEntry {
  return {
    name: summary.name,
    description: summary.description,
    ...(summary.whenToUse !== undefined ? { whenToUse: summary.whenToUse } : {}),
    source: summary.source,
    invocation: {
      modelInvocable: summary.invocation.modelInvocable !== false,
      userInvocable: summary.invocation.userInvocable !== false,
    },
    visibility: 'effective',
    ...(summary.path !== undefined ? { path: summary.path } : {}),
  }
}

// ---------------------------------------------------------------------------
// frontmatter（官方 skill-filesystem rc.5 规则的最小可靠实现）
// ---------------------------------------------------------------------------

/** 按官方规则解析一个技能指令文件（`---` YAML frontmatter）。 */
export function parseSkillFrontmatter(raw: string): ParsedSkill {
  const firstLineEnd = raw.indexOf('\n')
  if (firstLineEnd < 0 || raw.slice(0, firstLineEnd).replace(/\r$/, '') !== '---') {
    return { ok: false, reason: 'missing YAML frontmatter' }
  }
  const closingStart = findClosingFrontmatter(raw, firstLineEnd + 1)
  if (closingStart === undefined) return { ok: false, reason: 'missing YAML frontmatter' }
  let data: unknown
  try {
    data = parse(raw.slice(firstLineEnd + 1, closingStart))
  } catch (error) {
    return { ok: false, reason: `invalid YAML frontmatter: ${errorMessage(error)}` }
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { ok: false, reason: 'frontmatter must be a mapping' }
  }
  const fields = data as Record<string, unknown>
  const name = stringField(fields, 'name')
  if (name === undefined) return { ok: false, reason: 'frontmatter requires name and description' }
  const description = stringField(fields, 'description')
  if (description === undefined) return { ok: false, reason: 'frontmatter requires name and description' }
  if (!SKILL_NAME.test(name)) return { ok: false, reason: `invalid skill name "${name}"` }
  let invocation: SkillInvocationPolicy
  try {
    invocation = parseInvocationPolicy(fields)
  } catch (error) {
    return { ok: false, reason: `invalid invocation frontmatter: ${errorMessage(error)}` }
  }
  const whenToUse = stringField(fields, 'whenToUse')
  return {
    ok: true,
    name,
    description,
    ...(whenToUse !== undefined ? { whenToUse } : {}),
    invocation,
  }
}

/** 找到闭合 `---` 行的起始偏移（YAML 块在其之前结束）；无闭合 → undefined。 */
function findClosingFrontmatter(raw: string, start: number): number | undefined {
  let lineStart = start
  while (lineStart <= raw.length) {
    const nextNewline = raw.indexOf('\n', lineStart)
    const lineEnd = nextNewline < 0 ? raw.length : nextNewline
    if (raw.slice(lineStart, lineEnd).replace(/\r$/, '') === '---') return lineStart
    if (nextNewline < 0) return undefined
    lineStart = nextNewline + 1
  }
  return undefined
}

/** 非空字符串字段；缺失/类型不符 → undefined。 */
function stringField(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** 调用策略（官方键；legacy 键一律拒绝）。 */
function parseInvocationPolicy(data: Record<string, unknown>): SkillInvocationPolicy {
  rejectLegacyInvocationKey(data, 'disableModelInvocation', 'disable-model-invocation')
  rejectLegacyInvocationKey(data, 'modelInvocable', 'disable-model-invocation')
  rejectLegacyInvocationKey(data, 'userInvocable', 'user-invocable')
  return {
    modelInvocable: frontmatterBoolean(data, 'disable-model-invocation') !== true,
    userInvocable: frontmatterBoolean(data, 'user-invocable') !== false,
  }
}

function rejectLegacyInvocationKey(data: Record<string, unknown>, legacy: string, canonical: string): void {
  if (Object.hasOwn(data, legacy)) {
    throw new Error(`frontmatter field "${legacy}" is unsupported; use "${canonical}"`)
  }
}

/** 官方布尔解析：boolean/1/0/'1'/'0'/true|yes|on/false|no|off；其余报错。 */
function frontmatterBoolean(data: Record<string, unknown>, key: string): boolean | undefined {
  if (!Object.hasOwn(data, key)) return undefined
  const value = data[key]
  if (typeof value === 'boolean') return value
  if (value === 1 || value === '1') return true
  if (value === 0 || value === '0') return false
  if (typeof value === 'string') {
    switch (value.toLowerCase()) {
      case 'true': case 'yes': case 'on': return true
      case 'false': case 'no': case 'off': return false
    }
  }
  throw new TypeError(`frontmatter field "${key}" must be a boolean`)
}
