/**
 * Client i18n contract：中英字典一致性与本地化回退。
 *
 * 覆盖：键集合一致、无空值、占位符一致；所有已知 Skill 来源与 warning
 * code 均有双语；中文界面不使用「被遮蔽」；未知来源与未知/缺失 warning
 * item 回退 raw 文本。
 */
import { describe, expect, it } from 'vitest'
import {
  NS,
  en,
  sourceLabel,
  warningTexts,
  zh,
  type MessageTranslate,
  type TranslateParams,
} from '../src/client/i18n.ts'

/** 与宿主 locale 同语义的测试翻译器：缺键返回键名，支持 {name} 插值。 */
function translatorOf(dict: Record<string, string>): MessageTranslate {
  return (key, params) => {
    const template = dict[key]
    if (template === undefined) return key
    if (params === undefined) return template
    return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match))
  }
}

const zhT = translatorOf(zh as Record<string, string>)
const enT = translatorOf(en as Record<string, string>)

/** 文案中的占位符名（排序，便于比较）。 */
function placeholders(template: string): string[] {
  return [...template.matchAll(/\{(\w+)\}/g)].map((match) => match[1]!).sort()
}

/** 为模板生成占位符参数（值本身不参与断言）。 */
function paramsOf(template: string): TranslateParams {
  const params: TranslateParams = {}
  for (const name of placeholders(template)) params[name] = 'X'
  return params
}

/** 所有宿主 warning push 点使用的 code。 */
const WARNING_CODES = [
  'skills.unavailable',
  'skills.registryFailed',
  'skills.agentsUnavailable',
  'skills.sessionNoAgent',
  'skills.sessionAgentFailed',
  'skills.presetFailed',
  'skills.presetFailedFallback',
  'skills.shadowedIncomplete',
  'skills.priorityUnconfirmed',
  'skills.fileReadFailed',
  'skills.fileIgnored',
  'skills.rootReadFailed',
  'skills.aggregateFailed',
  'mcp.inventoryUnavailable',
  'mcp.inventoryReadFailed',
  'mcp.inventoryUnparsable',
  'mcp.entriesUnparsable',
  'mcp.presetsUnparsable',
  'mcp.invalidEnabledRows',
  'mcp.invalidRows',
  'mcp.duplicates',
  'mcp.managerReadFailed',
  'mcp.statusUnparsable',
  'mcp.presetInvalid',
  'mcp.presetNoId',
  'mcp.presetBroken',
  'mcp.presetBrokenNoReason',
  'mcp.presetRowsUnparsable',
  'mcp.aggregateFailed',
] as const

const SKILL_SOURCES: Record<string, { zh: string; en: string }> = {
  bundled: { zh: 'DSH 内置', en: 'DSH built-in' },
  runtime: { zh: '插件提供', en: 'Plugin runtime' },
  custom: { zh: '自定义目录', en: 'Custom directory' },
  'user-dsh': { zh: '用户 .dsh 目录', en: 'User .dsh directory' },
  'user-agents': { zh: '用户 .agents 目录', en: 'User .agents directory' },
  'project-dsh': { zh: '项目 .dsh 目录', en: 'Project .dsh directory' },
  'project-agents': { zh: '项目 .agents 目录', en: 'Project .agents directory' },
  global: { zh: '全局', en: 'Global' },
}

describe('字典一致性', () => {
  it('zh/en 键集合完全一致', () => {
    expect(NS).toBe('toolscontrol')
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })

  it('没有空值', () => {
    for (const [key, value] of [...Object.entries(zh), ...Object.entries(en)]) {
      expect(value.trim(), key).not.toBe('')
    }
  })

  it('每个键的中英占位符集合一致', () => {
    for (const key of Object.keys(zh) as (keyof typeof zh)[]) {
      expect(placeholders(en[key]), key).toEqual(placeholders(zh[key]))
    }
  })

  it('界面中文不使用领域术语「被遮蔽」；英文使用 Overridden 而非 Shadowed', () => {
    for (const [key, value] of Object.entries(zh)) {
      expect(value, key).not.toContain('被遮蔽')
    }
    for (const [key, value] of Object.entries(en)) {
      expect(value.toLowerCase(), key).not.toContain('shadowed')
    }
  })

  it('指定的关键 UI 文案符合约定', () => {
    const zhExpected: Record<string, string> = {
      'tab.skills': '技能',
      'search.skillsPlaceholder': '搜索技能名称、描述或适用场景',
      'search.aria.skills': '搜索技能',
      'workspace.title': '当前工作区：{title}',
      'status.lastRefreshed': '上次刷新：{time}',
      'skills.filter.allSources': '全部来源',
      'skills.filter.allInvocations': '全部调用方式',
      'filter.invocation.user': '用户可调用',
      'filter.invocation.model': '模型可调用',
      'filter.invocation.none': '不可调用',
      'warnings.title': '注意事项',
      'state.emptyFiltered': '没有找到符合条件的条目',
      'state.errorTitle': '无法获取数据',
      'skills.shadowedTitle': '同名但被覆盖的版本（{n}）',
      'skills.shadowedBy': '被「{source}」覆盖',
      'field.whenToUse': '适用场景',
    }
    for (const [key, expected] of Object.entries(zhExpected)) {
      expect(zh[key as keyof typeof zh]).toBe(expected)
    }
    expect(en['tab.skills']).toBe('Skills')
    expect(en['skills.shadowedTitle']).toBe('Same-name overridden versions ({n})')
    expect(en['skills.shadowedBy']).toBe('Overridden by {source}')
    expect(zh['warning.skills.shadowedIncomplete']).toBe(
      '同名技能可能来自运行时、预设或自定义目录；被覆盖的版本不一定会全部列出。',
    )
    expect(en['warning.skills.shadowedIncomplete']).toBe(
      'Skills with the same name can come from the runtime, presets, or custom directories. Some overridden versions may not be shown.',
    )
  })
})

describe('Skill 来源本地化', () => {
  it('所有已知来源都有准确的中英标签', () => {
    for (const [source, expected] of Object.entries(SKILL_SOURCES)) {
      expect(sourceLabel(source, zhT), source).toBe(expected.zh)
      expect(sourceLabel(source, enT), source).toBe(expected.en)
    }
  })

  it('unknown / 空来源显示未知；未来来源回退 raw id', () => {
    expect(sourceLabel('unknown', zhT)).toBe('未知')
    expect(sourceLabel('', zhT)).toBe('未知')
    expect(sourceLabel('unknown', enT)).toBe('Unknown')
    expect(sourceLabel('future-source', zhT)).toBe('future-source')
    expect(sourceLabel('future-source', enT)).toBe('future-source')
  })
})

describe('Warning 本地化与回退', () => {
  it('所有已知 warning code 都有双语文案，且没有遗漏/多余的 code', () => {
    const dictionaryCodes = Object.keys(zh)
      .filter((key) => key.startsWith('warning.'))
      .map((key) => key.slice('warning.'.length))
      .sort()
    expect(dictionaryCodes).toEqual([...WARNING_CODES].sort())

    for (const code of WARNING_CODES) {
      const key = `warning.${code}` as keyof typeof zh
      const zhText = zh[key]
      const enText = en[key]
      expect(zhText, key).toBeTruthy()
      expect(enText, key).toBeTruthy()
      expect(placeholders(enText), key).toEqual(placeholders(zhText))
    }
  })

  it('已知 code 按当前语言渲染并插值', () => {
    const params = paramsOf(zh['warning.mcp.duplicates'])
    expect(warningTexts(['raw'], [{ code: 'mcp.duplicates', params }], zhT)[0]).toBe(
      '已忽略 X 条重复的 MCP 条目（同一 profile/preset 作用域内同名条目只保留首条；不同作用域的同名条目不算重复）。',
    )
    expect(warningTexts(['raw'], [{ code: 'mcp.duplicates', params }], enT)[0]).toContain('Ignored X duplicate MCP entries')
  })

  it('每个已知 code 都能命中字典而不是回退 raw', () => {
    for (const code of WARNING_CODES) {
      const key = `warning.${code}` as keyof typeof zh
      const params = paramsOf(zh[key])
      expect(warningTexts(['RAW'], [{ code, params }], zhT)[0], code).not.toBe('RAW')
      expect(warningTexts(['RAW'], [{ code, params }], enT)[0], code).not.toBe('RAW')
    }
  })

  it('warningItems 缺失、长度不齐、未知 code 或空翻译时回退对应 raw', () => {
    expect(warningTexts(['raw-one', 'raw-two'], undefined, zhT)).toEqual(['raw-one', 'raw-two'])
    expect(warningTexts(['raw-one', 'raw-two'], [{ code: 'skills.unavailable' }], zhT)).toEqual([
      zh['warning.skills.unavailable'],
      'raw-two',
    ])
    expect(warningTexts(['raw-one'], [{ code: 'no.such.code' }], zhT)).toEqual(['raw-one'])
    expect(warningTexts(['raw-one'], [{ code: '' }], zhT)).toEqual(['raw-one'])
    expect(warningTexts(['raw-one'], [{ code: 'skills.unavailable' }], () => '')).toEqual(['raw-one'])
  })

  it('保持 warnings 顺序，忽略多余 item', () => {
    const lines = warningTexts(
      ['raw-a', 'raw-b'],
      [{ code: 'skills.shadowedIncomplete' }, { code: 'mcp.duplicates', params: { n: 1 } }, { code: 'skills.unavailable' }],
      zhT,
    )
    expect(lines).toHaveLength(2)
    expect(lines[0]).toBe(zh['warning.skills.shadowedIncomplete'])
    expect(lines[1]).toBe(
      '已忽略 1 条重复的 MCP 条目（同一 profile/preset 作用域内同名条目只保留首条；不同作用域的同名条目不算重复）。',
    )
    expect(warningTexts(['raw'], [{ code: 'skills.unavailable' }, { code: 'mcp.duplicates' }], zhT)).toEqual([
      zh['warning.skills.unavailable'],
    ])
  })
})
