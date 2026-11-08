/**
 * Skills 只读聚合 — 生效项映射（官方 ctx.skills 注册表）。
 *
 * 产品语义（CONTEXT.md「当前可见 Skills/生效 Skill/调用策略」）：
 * - 生效项来自官方注册表（赢家始终为主，插件不自行替换）；
 * - 以请求的 cwd（当前选中工作区）为项目级发现上下文；
 * - 每条标注来源与是否允许调用（model/user invocation）；
 * - 注册表缺失或读取失败 → 单来源降级 + warning，快照不失败。
 *
 * 被遮蔽版本的只读扫描在后续轮次（host-skills-shadowed）。
 */
import { describe, expect, it } from 'vitest'
import { SkillCatalog } from '../src/host/skills.ts'
import type { SkillSummaryFace, SkillsRegistryFace } from '../src/host/services.ts'

/** 构造官方 skills 注册表结构面，并记录收到的调用参数。 */
function registryOf(summaries: SkillSummaryFace[]): { registry: SkillsRegistryFace; calls: unknown[] } {
  const calls: unknown[] = []
  return {
    registry: {
      list: async (options) => {
        calls.push(options)
        return summaries
      },
    },
    calls,
  }
}

const EFFECTIVE: SkillSummaryFace[] = [
  {
    name: 'demo',
    description: 'Demo skill',
    whenToUse: 'when demonstrating',
    invocation: { modelInvocable: true, userInvocable: false },
    source: 'user-dsh',
    provider: 'filesystem',
    path: '/home/user/.dsh/skills/demo/SKILL.md',
  },
  {
    name: 'virtual',
    description: 'Virtual skill without path',
    invocation: { modelInvocable: false, userInvocable: true },
    source: 'runtime',
    provider: 'runtime',
  },
]

describe('Skills 生效项聚合（官方注册表）', () => {
  it('映射生效项：来源/调用策略/可见性如实透传', async () => {
    const { registry } = registryOf(EFFECTIVE)
    const snap = await new SkillCatalog({ registry }).snapshot()
    expect(snap.skills).toEqual([
      {
        name: 'demo',
        description: 'Demo skill',
        whenToUse: 'when demonstrating',
        source: 'user-dsh',
        invocation: { modelInvocable: true, userInvocable: false },
        visibility: 'effective',
        path: '/home/user/.dsh/skills/demo/SKILL.md',
      },
      {
        name: 'virtual',
        description: 'Virtual skill without path',
        source: 'runtime',
        invocation: { modelInvocable: false, userInvocable: true },
        visibility: 'effective',
      },
    ])
  })

  it('cwd 透传给官方注册表作为项目级发现上下文；cwd 缺省时以空选项调用', async () => {
    const { registry, calls } = registryOf([])
    await new SkillCatalog({ registry }).snapshot('/workspace/demo')
    expect(calls).toEqual([{ cwd: '/workspace/demo' }])
    const { registry: plain, calls: plainCalls } = registryOf([])
    await new SkillCatalog({ registry: plain }).snapshot()
    expect(plainCalls).toEqual([{}])
    expect(await new SkillCatalog({ registry: plain }).snapshot()).toMatchObject({ cwd: null })
  })

  it('skills 服务缺失时降级：空列表 + 明确 warning，快照不失败', async () => {
    const snap = await new SkillCatalog().snapshot()
    expect(snap.skills).toEqual([])
    expect(snap.warnings.join('\n')).toMatch(/skills 服务不可用/)
  })

  it('注册表读取失败时单来源降级：空列表 + warning', async () => {
    const registry: SkillsRegistryFace = { list: async () => { throw new Error('catalog boom') } }
    const snap = await new SkillCatalog({ registry }).snapshot()
    expect(snap.skills).toEqual([])
    expect(snap.warnings.join('\n')).toMatch(/catalog boom/)
  })

  it('warnings 与 warningItems 同序：raw 保回退、code 可本地化', async () => {
    const missing = await new SkillCatalog().snapshot()
    expect(missing.warningItems).toHaveLength(missing.warnings.length)
    expect(missing.warningItems?.map((item) => item.code)).toEqual(['skills.unavailable'])

    const { registry } = registryOf([EFFECTIVE[0]!])
    const snap = await new SkillCatalog({
      registry,
      roots: { dshHome: '/nonexistent-toolscontrol/dsh', agentsHome: '/nonexistent-toolscontrol/agents' },
    }).snapshot()
    expect(snap.warningItems).toHaveLength(snap.warnings.length)
    expect(snap.warningItems?.[0]?.code).toBe('skills.shadowedIncomplete')
  })
})

// ---------------------------------------------------------------------------
// 被遮蔽版本：只读文件扫描（官方已确认根目录；官方赢家始终为主）
// ---------------------------------------------------------------------------

import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

/** 建一个一次性用户根目录（作为 dshHome/agentsHome/cwd 注入）。 */
function makeTempRoot(): string {
  return mkdtempSync(join(tmpdir(), 'toolscontrol-skills-'))
}

/** 写一个技能指令文件（frontmatter 正文按官方 `---` YAML 规则）。 */
function writeSkill(root: string, relPath: string, frontmatter: string, raw = false): string {
  const file = join(root, relPath)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, raw ? frontmatter : `---\n${frontmatter}\n---\nbody\n`, 'utf8')
  return file
}

/** bundled 生效项（rank 600，稳定不与文件根冲突）。 */
function bundledWinner(name: string, path: string): SkillSummaryFace {
  return {
    name,
    description: `${name} winner`,
    invocation: { modelInvocable: true, userInvocable: true },
    source: 'bundled',
    provider: 'filesystem',
    path,
  }
}

describe('Skills 被遮蔽版本（只读文件扫描）', () => {
  // 优先级语义（官方：rank 低者胜）：被遮蔽版本的来源 rank 必须高于
  // 生效赢家；文件版本 rank 不高于赢家（或赢家来源未知）属于异常，
  // 不判遮蔽、只给警告（官方赢家始终为主）。
  it('同名文件版本作为被遮蔽项补充：标注来源/路径/遮蔽者/调用策略', async () => {
    const dshHome = makeTempRoot()
    const agentsHome = makeTempRoot()
    try {
      const scanned = writeSkill(join(agentsHome, 'skills'), 'demo/SKILL.md', 'name: demo\ndescription: Shadowed copy\ndisable-model-invocation: true')
      const { registry } = registryOf([{ ...bundledWinner('demo', '/dsh-home/demo/SKILL.md'), source: 'user-dsh' }])
      const snap = await new SkillCatalog({ registry, roots: { dshHome, agentsHome } }).snapshot()
      expect(snap.skills).toHaveLength(2)
      expect(snap.skills[0]).toMatchObject({ name: 'demo', visibility: 'effective', source: 'user-dsh' })
      expect(snap.skills[1]).toEqual({
        name: 'demo',
        description: 'Shadowed copy',
        source: 'user-agents',
        invocation: { modelInvocable: false, userInvocable: true },
        visibility: 'shadowed',
        shadowedBy: 'user-dsh',
        path: scanned,
      })
    } finally {
      rmSync(dshHome, { recursive: true, force: true })
      rmSync(agentsHome, { recursive: true, force: true })
    }
  })

  it('目录包与平铺两种布局都识别，嵌套与无关文件不扫描', async () => {
    const dshHome = makeTempRoot()
    const agentsHome = makeTempRoot()
    try {
      const alpha = writeSkill(join(agentsHome, 'skills'), 'alpha/SKILL.md', 'name: alpha\ndescription: Dir bundle')
      const beta = writeSkill(join(agentsHome, 'skills'), 'beta.md', 'name: beta\ndescription: Flat file')
      writeSkill(join(agentsHome, 'skills'), 'gamma/nested/SKILL.md', 'name: gamma\ndescription: Nested — must be ignored')
      writeSkill(join(agentsHome, 'skills'), 'notes.txt', 'not a skill')
      const { registry } = registryOf([
        { ...bundledWinner('alpha', '/b/alpha'), source: 'user-dsh' },
        { ...bundledWinner('beta', '/b/beta'), source: 'user-dsh' },
      ])
      const snap = await new SkillCatalog({ registry, roots: { dshHome, agentsHome } }).snapshot()
      const shadowed = snap.skills.filter((entry) => entry.visibility === 'shadowed')
      expect(shadowed.map((entry) => entry.name).sort()).toEqual(['alpha', 'beta'])
      expect(shadowed.find((entry) => entry.name === 'alpha')?.path).toBe(alpha)
      expect(shadowed.find((entry) => entry.name === 'beta')?.path).toBe(beta)
    } finally {
      rmSync(dshHome, { recursive: true, force: true })
      rmSync(agentsHome, { recursive: true, force: true })
    }
  })

  it('malformed 条目单条 warning 并跳过，不影响其他条目', async () => {
    const dshHome = makeTempRoot()
    const agentsHome = makeTempRoot()
    try {
      const root = join(agentsHome, 'skills')
      const noFrontmatter = writeSkill(root, 'a.md', 'just text, no frontmatter', true)
      const noDescription = writeSkill(root, 'b.md', 'name: b')
      const badName = writeSkill(root, 'c.md', 'name: BadName\ndescription: x')
      const legacyKey = writeSkill(root, 'd.md', 'name: d\ndescription: x\nmodelInvocable: false')
      const good = writeSkill(root, 'e.md', 'name: e\ndescription: fine')
      const { registry } = registryOf(['a', 'b', 'c', 'd', 'e'].map((name) => ({ ...bundledWinner(name, `/b/${name}`), source: 'user-dsh' })))
      const snap = await new SkillCatalog({ registry, roots: { dshHome, agentsHome } }).snapshot()
      const shadowed = snap.skills.filter((entry) => entry.visibility === 'shadowed')
      expect(shadowed.map((entry) => entry.name)).toEqual(['e'])
      for (const broken of [noFrontmatter, noDescription, badName, legacyKey]) {
        expect(snap.warnings.some((warning) => warning.includes(broken))).toBe(true)
      }
    } finally {
      rmSync(dshHome, { recursive: true, force: true })
      rmSync(agentsHome, { recursive: true, force: true })
    }
  })

  it('文件读取失败只产生单条 warning，其余条目继续', async () => {
    if (process.platform === 'win32') return
    const dshHome = makeTempRoot()
    const agentsHome = makeTempRoot()
    try {
      const root = join(agentsHome, 'skills')
      const broken = writeSkill(root, 'broken/SKILL.md', 'name: broken\ndescription: unreadable')
      chmodSync(broken, 0o000)
      const good = writeSkill(root, 'good.md', 'name: good\ndescription: fine')
      const { registry } = registryOf([
        { ...bundledWinner('broken', '/b/broken'), source: 'user-dsh' },
        { ...bundledWinner('good', '/b/good'), source: 'user-dsh' },
      ])
      try {
        const snap = await new SkillCatalog({ registry, roots: { dshHome, agentsHome } }).snapshot()
        expect(snap.skills.filter((entry) => entry.visibility === 'shadowed').map((entry) => entry.name)).toEqual(['good'])
        expect(snap.warnings.some((warning) => warning.includes(broken))).toBe(true)
      } finally {
        chmodSync(broken, 0o644)
      }
    } finally {
      rmSync(dshHome, { recursive: true, force: true })
      rmSync(agentsHome, { recursive: true, force: true })
    }
  })

  it('扫描根不存在时静默（除常驻枚举限制外无 warning）', async () => {
    const home = makeTempRoot()
    try {
      const { registry } = registryOf([{ ...bundledWinner('demo', '/b/demo'), source: 'user-dsh' }])
      const snap = await new SkillCatalog({ registry, roots: { dshHome: home, agentsHome: home } }).snapshot()
      expect(snap.warnings.filter((warning) => !warning.includes('不可完整枚举'))).toEqual([])
      expect(snap.skills.filter((entry) => entry.visibility === 'shadowed')).toEqual([])
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('与生效项同路径（同一文件）不重复列出', async () => {
    const dshHome = makeTempRoot()
    const agentsHome = makeTempRoot()
    try {
      const actual = writeSkill(join(agentsHome, 'skills'), 'demo/SKILL.md', 'name: demo\ndescription: The winner itself')
      const { registry } = registryOf([{ ...bundledWinner('demo', actual), source: 'user-agents' }])
      const snap = await new SkillCatalog({ registry, roots: { dshHome, agentsHome } }).snapshot()
      expect(snap.skills.filter((entry) => entry.name === 'demo')).toHaveLength(1)
      expect(snap.skills[0]?.visibility).toBe('effective')
      expect(snap.warnings.filter((warning) => !warning.includes('不可完整枚举'))).toEqual([])
    } finally {
      rmSync(dshHome, { recursive: true, force: true })
      rmSync(agentsHome, { recursive: true, force: true })
    }
  })

  it('文件版本优先级不高于生效版本（或生效来源未知）时不判遮蔽，给优先级警告', async () => {
    const dshHome = makeTempRoot()
    const agentsHome = makeTempRoot()
    try {
      // 文件在 user-dsh 根（rank 400），赢家是 user-agents（rank 500）：
      // 文件优先级反而更高却未生效——官方语义下不可解释，不判遮蔽。
      writeSkill(join(dshHome, 'skills'), 'low/SKILL.md', 'name: low\ndescription: higher priority than winner')
      writeSkill(join(agentsHome, 'skills'), 'odd/SKILL.md', 'name: odd\ndescription: winner with unknown source')
      const { registry } = registryOf([
        { ...bundledWinner('low', '/b/low'), source: 'user-agents' },
        { ...bundledWinner('odd', '/b/odd'), source: 'mystery-source' },
      ])
      const snap = await new SkillCatalog({ registry, roots: { dshHome, agentsHome } }).snapshot()
      expect(snap.skills.filter((entry) => entry.visibility === 'shadowed')).toEqual([])
      expect(snap.warnings.some((warning) => warning.includes('low'))).toBe(true)
      expect(snap.warnings.some((warning) => warning.includes('odd'))).toBe(true)
    } finally {
      rmSync(dshHome, { recursive: true, force: true })
      rmSync(agentsHome, { recursive: true, force: true })
    }
  })

  it('无同名生效项的文件项保守不列入（生效性不可确认）', async () => {
    const dshHome = makeTempRoot()
    const agentsHome = makeTempRoot()
    try {
      writeSkill(join(agentsHome, 'skills'), 'orphan.md', 'name: orphan\ndescription: no winner by this name')
      const { registry } = registryOf([{ ...bundledWinner('other', '/b/other'), source: 'user-dsh' }])
      const snap = await new SkillCatalog({ registry, roots: { dshHome, agentsHome } }).snapshot()
      expect(snap.skills.some((entry) => entry.name === 'orphan')).toBe(false)
      expect(snap.warnings.filter((warning) => !warning.includes('不可完整枚举'))).toEqual([])
    } finally {
      rmSync(dshHome, { recursive: true, force: true })
      rmSync(agentsHome, { recursive: true, force: true })
    }
  })

  it('项目根随 cwd 扫描（project-agents）；无 cwd 不扫项目根', async () => {
    const dshHome = makeTempRoot()
    const agentsHome = makeTempRoot()
    const project = makeTempRoot()
    try {
      const projectSkill = writeSkill(join(project, '.agents', 'skills'), 'demo/SKILL.md', 'name: demo\ndescription: Project copy')
      const { registry } = registryOf([{ ...bundledWinner('demo', '/elsewhere/demo/SKILL.md'), source: 'project-dsh' }])
      const catalog = new SkillCatalog({ registry, roots: { dshHome, agentsHome } })
      const withCwd = await catalog.snapshot(project)
      expect(withCwd.skills.filter((entry) => entry.visibility === 'shadowed').map((entry) => entry.path)).toEqual([projectSkill])
      expect(withCwd.cwd).toBe(project)
      const withoutCwd = await catalog.snapshot()
      expect(withoutCwd.skills.filter((entry) => entry.visibility === 'shadowed')).toEqual([])
    } finally {
      rmSync(dshHome, { recursive: true, force: true })
      rmSync(agentsHome, { recursive: true, force: true })
      rmSync(project, { recursive: true, force: true })
    }
  })
})

describe('同名多个被遮蔽版本', () => {
  it('同名生效项的多个文件版本（不同来源/根）全部列出，官方 winner 不受影响', async () => {
    const dshHome = makeTempRoot()
    const agentsHome = makeTempRoot()
    const project = makeTempRoot()
    try {
      const inProjectAgents = writeSkill(join(project, '.agents', 'skills'), 'demo/SKILL.md', 'name: demo\ndescription: project agents copy')
      const inUserDsh = writeSkill(join(dshHome, 'skills'), 'demo/SKILL.md', 'name: demo\ndescription: user dsh copy')
      const inUserAgents = writeSkill(join(agentsHome, 'skills'), 'demo.md', 'name: demo\ndescription: user agents copy')
      const { registry } = registryOf([{ ...bundledWinner('demo', '/elsewhere/demo/SKILL.md'), source: 'project-dsh' }])
      const snap = await new SkillCatalog({ registry, roots: { dshHome, agentsHome } }).snapshot(project)
      expect(snap.skills.filter((entry) => entry.visibility === 'effective')).toEqual([
        {
          name: 'demo',
          description: 'demo winner',
          source: 'project-dsh',
          invocation: { modelInvocable: true, userInvocable: true },
          visibility: 'effective',
          path: '/elsewhere/demo/SKILL.md',
        },
      ])
      const shadowed = snap.skills.filter((entry) => entry.visibility === 'shadowed')
      expect(shadowed.map((entry) => [entry.source, entry.path])).toEqual([
        ['project-agents', inProjectAgents],
        ['user-dsh', inUserDsh],
        ['user-agents', inUserAgents],
      ])
      expect(shadowed.every((entry) => entry.shadowedBy === 'project-dsh')).toBe(true)
    } finally {
      rmSync(dshHome, { recursive: true, force: true })
      rmSync(agentsHome, { recursive: true, force: true })
      rmSync(project, { recursive: true, force: true })
    }
  })
})
