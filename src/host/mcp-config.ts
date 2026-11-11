/**
 * MCP 探测配置读取（只读、最小面）。
 *
 * 探测需要**真实配置**（stdio 的 command/args/env 或 streamable-http 的
 * url/headers），而 `pluginInventory` 只投影 `{entryId, moduleName,
 * enabled}`。本模块因此直接读取两个官方配置面：
 *
 * - profile 根级：`ctx.loader.entries()` 的 `entry.options.config`；
 * - agent preset：`ctx.agentPresets.compositionInventory()` 给出行的启用
 *   状态，`readDocument(id)` 给出声明的子插件 YAML。
 *
 * 两个面都是可选的：运行时能力检测失败只让相关条目变成“不可探测”，
 * 绝不影响既有 inventory 总览。凭据/命令/URL 只在本模块与探测运行时
 * 的内存中存在，绝不进入 wire DTO。
 *
 * `!!js` 表达式只允许“纯 process.env”子集：由本模块的受限求值器求值；
 * 依赖 `ctx`、函数调用或其它全局对象的表达式一律判为不可可靠求值，
 * 不猜值。
 *
 * @module @hanxu131/toolscontrol-dsh/host/mcp-config
 */

import { parse as parseYaml } from 'yaml'
import type { McpPresetRef, McpProbeUnavailableReason } from '../shared/protocol.ts'
import type { AgentPresetsFace, LoaderFace, PluginInventoryPresetFace, PluginInventoryPresetRowFace } from './services.ts'

/** Loader 条目视作 MCP 配置项的模块名（官方包名与插件短名）。 */
const MCP_CLIENT_MODULES = new Set(['@deepseek-ai/dsh-mcp-client', 'mcp-client'])

/** 是否为 MCP 客户端配置条目（精确匹配，避免前缀/后缀误判）。 */
export function isMcpClientModule(moduleName: string): boolean {
  return MCP_CLIENT_MODULES.has(moduleName)
}

/** 解析后的探测配置：凭据只在这里与运行时内存中存在。 */
export type ProbeTransportConfig =
  | {
      transport: 'stdio'
      serverName: string
      command: string
      args: string[]
      env: Record<string, string>
      cwd?: string
    }
  | {
      transport: 'streamable-http'
      serverName: string
      url: string
      headers: Record<string, string>
    }

/** 一条可（或不可）探测的配置条目。 */
export interface ProbeCandidate {
  /** 稳定探测键（scope/presetId/entryId 消歧后）。 */
  probeKey: string
  scope: 'profile' | 'preset'
  preset?: McpPresetRef
  /** 声明 id；没有时为 null。 */
  entryId: string | null
  /** 与 inventory 条目名一致（entryId 或 moduleName）。 */
  name: string
  /** inventory 语义的启用状态（条件启用保持 true + conditional）。 */
  enabled: boolean
  conditional?: true
  probeAvailable: boolean
  probeUnavailableReason?: McpProbeUnavailableReason
  config?: ProbeTransportConfig
}

/** 一次配置读取的结果（candidate 只含探测所需字段）。 */
export interface ProbeConfigCollection {
  candidates: ProbeCandidate[]
  /** 至少一个配置面可读。 */
  available: boolean
  /** profile 根级配置可读。 */
  profile: boolean
  /** preset 声明与 YAML 文档都可读。 */
  presets: boolean
  reason?: 'config_source_unavailable' | 'runtime_unavailable'
}

/** 探测配置读取面（测试可注入静态实现）。 */
export interface ProbeConfigReaderFace {
  /**
   * 读取探测配置。`signal` 是**协作**取消：实现应在两次 await 之间检查
   * 并尽快返回；调用方（探测服务）另有一层硬上界与赛跑兜底，因此即使
   * 实现忽略 signal 也不会永久挂起。
   */
  collect(options?: { signal?: AbortSignal }): Promise<ProbeConfigCollection>
}

// ---------------------------------------------------------------------------
// 纯 process.env 表达式求值（受限解释器；不执行任意 JS）
// ---------------------------------------------------------------------------

type EvalValue = string | number | boolean | null | undefined

class EnvEvalError extends Error {}

type Token =
  | { kind: 'str'; value: string }
  | { kind: 'num'; value: number }
  | { kind: 'ident'; value: string }
  | { kind: 'punct'; value: string }
  | { kind: 'template'; parts: readonly (string | { expr: string })[] }

function isIdentStart(char: string | undefined): boolean {
  return char !== undefined && /[A-Za-z_$]/.test(char)
}

function isIdentPart(char: string | undefined): boolean {
  return char !== undefined && /[A-Za-z0-9_$]/.test(char)
}

function readEscape(source: string, index: number): { value: string; next: number } {
  const char = source[index]
  if (char === undefined) throw new EnvEvalError('escape at end of input')
  const simple: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', '0': '\0' }
  const mapped = simple[char]
  if (mapped !== undefined) return { value: mapped, next: index + 1 }
  if (char === 'x') {
    const hex = source.slice(index + 1, index + 3)
    if (!/^[0-9a-fA-F]{2}$/.test(hex)) throw new EnvEvalError('bad hex escape')
    return { value: String.fromCharCode(Number.parseInt(hex, 16)), next: index + 3 }
  }
  if (char === 'u') {
    const hex = source.slice(index + 1, index + 5)
    if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new EnvEvalError('bad unicode escape')
    return { value: String.fromCharCode(Number.parseInt(hex, 16)), next: index + 5 }
  }
  return { value: char, next: index + 1 }
}

/** 扫描模板字面量 `${...}` 的插值源（支持嵌套字符串/模板/括号）。 */
function readTemplate(source: string, start: number): { parts: (string | { expr: string })[]; next: number } {
  const parts: (string | { expr: string })[] = []
  let buffer = ''
  let index = start + 1
  while (index < source.length) {
    const char = source[index]
    if (char === undefined) break
    if (char === '\\') {
      const escaped = readEscape(source, index + 1)
      buffer += escaped.value
      index = escaped.next
      continue
    }
    if (char === '`') {
      if (buffer !== '') parts.push(buffer)
      return { parts, next: index + 1 }
    }
    if (char === '$' && source[index + 1] === '{') {
      if (buffer !== '') parts.push(buffer)
      buffer = ''
      const exprStart = index + 2
      let depth = 1
      let cursor = exprStart
      while (cursor < source.length && depth > 0) {
        const inner = source[cursor]
        if (inner === undefined) break
        if (inner === "'" || inner === '"') {
          cursor += 1
          while (cursor < source.length && source[cursor] !== inner) {
            if (source[cursor] === '\\') cursor += 1
            cursor += 1
          }
        } else if (inner === '`') {
          const nested = readTemplate(source, cursor)
          cursor = nested.next
          continue
        } else if (inner === '{') {
          depth += 1
        } else if (inner === '}') {
          depth -= 1
          if (depth === 0) break
        }
        cursor += 1
      }
      if (depth !== 0) throw new EnvEvalError('unterminated template interpolation')
      parts.push({ expr: source.slice(exprStart, cursor) })
      index = cursor + 1
      continue
    }
    buffer += char
    index += 1
  }
  throw new EnvEvalError('unterminated template literal')
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  let index = 0
  while (index < source.length) {
    const char = source[index]
    if (char === undefined) break
    if (/\s/.test(char)) {
      index += 1
      continue
    }
    if (char === "'" || char === '"') {
      let value = ''
      let cursor = index + 1
      let closed = false
      while (cursor < source.length) {
        const inner = source[cursor]
        if (inner === undefined) break
        if (inner === '\\') {
          const escaped = readEscape(source, cursor + 1)
          value += escaped.value
          cursor = escaped.next
          continue
        }
        if (inner === char) {
          closed = true
          cursor += 1
          break
        }
        value += inner
        cursor += 1
      }
      if (!closed) throw new EnvEvalError('unterminated string')
      tokens.push({ kind: 'str', value })
      index = cursor
      continue
    }
    if (char === '`') {
      const template = readTemplate(source, index)
      tokens.push({ kind: 'template', parts: template.parts })
      index = template.next
      continue
    }
    if (/[0-9]/.test(char)) {
      let cursor = index
      while (cursor < source.length && /[0-9.]/.test(source[cursor] ?? '')) cursor += 1
      const text = source.slice(index, cursor)
      const value = Number(text)
      if (!Number.isFinite(value)) throw new EnvEvalError('bad number')
      tokens.push({ kind: 'num', value })
      index = cursor
      continue
    }
    if (isIdentStart(char)) {
      let cursor = index + 1
      while (cursor < source.length && isIdentPart(source[cursor])) cursor += 1
      tokens.push({ kind: 'ident', value: source.slice(index, cursor) })
      index = cursor
      continue
    }
    const three = source.slice(index, index + 3)
    if (three === '===' || three === '!==') {
      tokens.push({ kind: 'punct', value: three })
      index += 3
      continue
    }
    const two = source.slice(index, index + 2)
    if (['==', '!=', '&&', '||', '??'].includes(two)) {
      tokens.push({ kind: 'punct', value: two })
      index += 2
      continue
    }
    if (['.', '[', ']', '(', ')', '+', '!', '?', ':'].includes(char)) {
      tokens.push({ kind: 'punct', value: char })
      index += 1
      continue
    }
    throw new EnvEvalError(`unsupported character ${char}`)
  }
  return tokens
}

class EnvExpressionParser {
  private index = 0
  private readonly tokens: readonly Token[]

  constructor(tokens: readonly Token[]) {
    this.tokens = tokens
  }

  parse(): EvalValue {
    const value = this.parseConditional()
    if (this.index !== this.tokens.length) throw new EnvEvalError('trailing tokens')
    return value
  }

  private peek(): Token | undefined {
    return this.tokens[this.index]
  }

  private peekPunct(value: string): boolean {
    const token = this.peek()
    return token !== undefined && token.kind === 'punct' && token.value === value
  }

  private consumePunct(value: string): boolean {
    if (!this.peekPunct(value)) return false
    this.index += 1
    return true
  }

  private expectPunct(value: string): void {
    if (!this.consumePunct(value)) throw new EnvEvalError(`expected ${value}`)
  }

  private parseConditional(): EvalValue {
    const test = this.parseOr()
    if (!this.consumePunct('?')) return test
    const consequent = this.parseConditional()
    this.expectPunct(':')
    const alternate = this.parseConditional()
    return truthy(test) ? consequent : alternate
  }

  private parseOr(): EvalValue {
    let left = this.parseAnd()
    while (this.peekPunct('||') || this.peekPunct('??')) {
      const operator = (this.peek() as { kind: 'punct'; value: string }).value
      this.index += 1
      const right = this.parseAnd()
      if (operator === '||') left = truthy(left) ? left : right
      else left = left === null || left === undefined ? right : left
    }
    return left
  }

  private parseAnd(): EvalValue {
    let left = this.parseEquality()
    while (this.peekPunct('&&')) {
      this.index += 1
      const right = this.parseEquality()
      left = truthy(left) ? right : left
    }
    return left
  }

  private parseEquality(): EvalValue {
    let left = this.parseAdditive()
    while (
      this.peekPunct('===') ||
      this.peekPunct('!==') ||
      this.peekPunct('==') ||
      this.peekPunct('!=')
    ) {
      const operator = (this.peek() as { kind: 'punct'; value: string }).value
      this.index += 1
      const right = this.parseAdditive()
      const equal = left === right
      left = operator === '===' || operator === '==' ? equal : !equal
    }
    return left
  }

  private parseAdditive(): EvalValue {
    let left = this.parseUnary()
    while (this.peekPunct('+')) {
      this.index += 1
      const right = this.parseUnary()
      if (typeof left === 'string' || typeof right === 'string') {
        if (left === undefined || right === undefined || left === null || right === null) {
          throw new EnvEvalError('string concatenation of a missing value')
        }
        left = `${String(left)}${String(right)}`
      } else if (typeof left === 'number' && typeof right === 'number') {
        left += right
      } else {
        throw new EnvEvalError('unsupported + operands')
      }
    }
    return left
  }

  private parseUnary(): EvalValue {
    if (this.consumePunct('!')) return !truthy(this.parseUnary())
    return this.parsePrimary()
  }

  private parsePrimary(): EvalValue {
    const token = this.peek()
    if (token === undefined) throw new EnvEvalError('unexpected end')
    if (token.kind === 'str') {
      this.index += 1
      return token.value
    }
    if (token.kind === 'num') {
      this.index += 1
      return token.value
    }
    if (token.kind === 'template') {
      this.index += 1
      let text = ''
      for (const part of token.parts) {
        if (typeof part === 'string') {
          text += part
          continue
        }
        const value = evaluateEnvExpression(part.expr)
        if (!value.ok) throw new EnvEvalError('unsupported template interpolation')
        if (value.value === undefined || value.value === null) {
          throw new EnvEvalError('missing value in template')
        }
        text += String(value.value)
      }
      return text
    }
    if (token.kind === 'ident') {
      if (token.value === 'true') {
        this.index += 1
        return true
      }
      if (token.value === 'false') {
        this.index += 1
        return false
      }
      if (token.value === 'null') {
        this.index += 1
        return null
      }
      if (token.value === 'undefined') {
        this.index += 1
        return undefined
      }
      if (token.value !== 'process') throw new EnvEvalError(`unsupported identifier ${token.value}`)
      this.index += 1
      this.expectPunct('.')
      const env = this.peek()
      if (env === undefined || env.kind !== 'ident' || env.value !== 'env') {
        throw new EnvEvalError('only process.env is supported')
      }
      this.index += 1
      if (this.consumePunct('.')) {
        const name = this.peek()
        if (name === undefined || name.kind !== 'ident') throw new EnvEvalError('expected env name')
        this.index += 1
        return process.env[name.value]
      }
      if (this.consumePunct('[')) {
        const name = this.peek()
        if (name === undefined || name.kind !== 'str') throw new EnvEvalError('expected env name')
        this.index += 1
        this.expectPunct(']')
        return process.env[name.value]
      }
      throw new EnvEvalError('expected env accessor')
    }
    if (this.consumePunct('(')) {
      const value = this.parseConditional()
      this.expectPunct(')')
      return value
    }
    throw new EnvEvalError('unsupported expression')
  }
}

function truthy(value: EvalValue): boolean {
  return Boolean(value)
}

/**
 * 求值一个纯 `process.env` 表达式。只支持字面量、`process.env.NAME`
 * （含 `['NAME']`）、模板字面量、`+`/`!`/`&&`/`||`/`??`/比较/三元与
 * 括号；任何其它标识符或调用都判为不可求值。
 */
export function evaluateEnvExpression(source: string): { ok: true; value: EvalValue } | { ok: false } {
  try {
    const tokens = tokenize(source)
    const value = new EnvExpressionParser(tokens).parse()
    return { ok: true, value }
  } catch (error) {
    if (error instanceof EnvEvalError) return { ok: false }
    return { ok: false }
  }
}

/** 判断值是否是 Loader 的 `!!js` 表达式节点。 */
function isJsExpr(value: unknown): value is { __jsExpr: string } {
  return typeof value === 'object' && value !== null && typeof (value as { __jsExpr?: unknown }).__jsExpr === 'string'
}

class ConfigUnresolved extends Error {}

/** 递归求值配置中的 `!!js` 节点；不可求值即整体不可用。 */
function resolveDeep(value: unknown): unknown {
  if (isJsExpr(value)) {
    const result = evaluateEnvExpression(value.__jsExpr)
    if (!result.ok) throw new ConfigUnresolved()
    return result.value
  }
  if (Array.isArray(value)) return value.map((item) => resolveDeep(item))
  if (typeof value === 'object' && value !== null) {
    const output: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) output[key] = resolveDeep(item)
    return output
  }
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined
  const output: Record<string, string> = {}
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== 'string') return undefined
    output[key] = item
  }
  return output
}

function resolveField(value: unknown): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: resolveDeep(value) }
  } catch {
    return { ok: false }
  }
}

/**
 * 只解析探测真正需要的字段：未使用的配置项（如 reconnect 的私有表达式）
 * 不会让整个条目变成不可探测。任何被使用字段的 `!!js` 表达式不可求值
 * 时，整个配置判为 config_unresolved。
 */
function normalizeServerConfig(raw: unknown): { ok: true; config: ProbeTransportConfig } | { ok: false; reason: McpProbeUnavailableReason } {
  if (raw === undefined || raw === null) return { ok: false, reason: 'config_missing' }
  if (!isRecord(raw)) return { ok: false, reason: 'config_missing' }
  const transportValue = resolveField(raw.transport)
  if (!transportValue.ok) return { ok: false, reason: 'config_unresolved' }
  const transport = transportValue.value
  if (transport === undefined || transport === null) return { ok: false, reason: 'config_missing' }
  if (transport === 'stdio') {
    const serverNameValue = resolveField(raw.serverName)
    const commandValue = resolveField(raw.command)
    if (!serverNameValue.ok || !commandValue.ok) return { ok: false, reason: 'config_unresolved' }
    const serverName = serverNameValue.value
    const command = commandValue.value
    if (typeof serverName !== 'string' || serverName === '') return { ok: false, reason: 'config_unresolved' }
    if (typeof command !== 'string' || command === '') return { ok: false, reason: 'config_unresolved' }
    const argsValue = resolveField(raw.args)
    if (!argsValue.ok) return { ok: false, reason: 'config_unresolved' }
    const argsRaw = argsValue.value
    const args = argsRaw === undefined ? [] : Array.isArray(argsRaw) && argsRaw.every((item) => typeof item === 'string') ? (argsRaw as string[]) : undefined
    if (args === undefined) return { ok: false, reason: 'config_unresolved' }
    const envValue = resolveField(raw.env)
    if (!envValue.ok) return { ok: false, reason: 'config_unresolved' }
    const envRaw = envValue.value
    const env = envRaw === undefined ? {} : stringRecord(envRaw)
    if (env === undefined) return { ok: false, reason: 'config_unresolved' }
    const cwdValue = resolveField(raw.cwd)
    if (!cwdValue.ok) return { ok: false, reason: 'config_unresolved' }
    const cwd = cwdValue.value
    if (cwd !== undefined && cwd !== null && typeof cwd !== 'string') return { ok: false, reason: 'config_unresolved' }
    return {
      ok: true,
      config: {
        transport: 'stdio',
        serverName,
        command,
        args,
        env,
        ...(typeof cwd === 'string' && cwd !== '' ? { cwd } : {}),
      },
    }
  }
  if (transport === 'streamable-http') {
    const serverNameValue = resolveField(raw.serverName)
    const urlValue = resolveField(raw.url)
    if (!serverNameValue.ok || !urlValue.ok) return { ok: false, reason: 'config_unresolved' }
    const serverName = serverNameValue.value
    const url = urlValue.value
    if (typeof serverName !== 'string' || serverName === '') return { ok: false, reason: 'config_unresolved' }
    if (typeof url !== 'string' || url === '') return { ok: false, reason: 'config_unresolved' }
    try {
      const parsed = new URL(url)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { ok: false, reason: 'config_unresolved' }
    } catch {
      return { ok: false, reason: 'config_unresolved' }
    }
    const headersValue = resolveField(raw.headers)
    if (!headersValue.ok) return { ok: false, reason: 'config_unresolved' }
    const headersRaw = headersValue.value
    const headers = headersRaw === undefined ? {} : stringRecord(headersRaw)
    if (headers === undefined) return { ok: false, reason: 'config_unresolved' }
    return { ok: true, config: { transport: 'streamable-http', serverName, url, headers } }
  }
  return { ok: false, reason: 'unsupported_transport' }
}

// ---------------------------------------------------------------------------
// preset YAML（readDocument）解析
// ---------------------------------------------------------------------------

/** `yaml` 自定义标签：把 js-yaml 的 `!!js` 标量还原为表达式节点。 */
const JS_EXPR_TAG = {
  tag: 'tag:yaml.org,2002:js',
  resolve: (value: string): unknown => ({ __jsExpr: value }),
}

interface DeclaredRow {
  id: string | null
  moduleName: string
  config: unknown
  disabled: unknown
}

/** 按官方 entry-list 语义扁平化声明行（保留嵌套 group）。 */
function flattenDeclaredRows(rows: unknown, output: DeclaredRow[]): boolean {
  if (!Array.isArray(rows)) return false
  for (const value of rows) {
    if (!isRecord(value)) return false
    const moduleName = value.name
    if (typeof moduleName !== 'string' || moduleName === '') return false
    if (value.group === true) {
      if (!flattenDeclaredRows(value.config, output)) return false
      continue
    }
    output.push({
      id: typeof value.id === 'string' && value.id !== '' ? value.id : null,
      moduleName,
      config: value.config,
      disabled: value.disabled,
    })
  }
  return true
}

function parsePresetRows(content: string): DeclaredRow[] | undefined {
  let parsed: unknown
  try {
    parsed = parseYaml(content, { customTags: [JS_EXPR_TAG] })
  } catch {
    return undefined
  }
  const rows: DeclaredRow[] = []
  return flattenDeclaredRows(parsed, rows) ? rows : undefined
}

/** 求值行自身的 `disabled` 表达式（与 Loader 一致按 JS 真值判断）。 */
function evaluateDisabled(value: unknown): boolean | 'conditional' | undefined {
  if (typeof value === 'boolean') return value
  if (value === null) return false
  if (!isJsExpr(value)) return undefined
  const result = evaluateEnvExpression(value.__jsExpr)
  if (!result.ok) return 'conditional'
  return Boolean(result.value)
}

// ---------------------------------------------------------------------------
// 配置读取器
// ---------------------------------------------------------------------------

/** 协作取消用的 AbortError（与服务层赛跑的错误同形，不携带任何路径/凭据）。 */
function abortError(): Error {
  const error = new Error('mcp config collection aborted')
  error.name = 'AbortError'
  return error
}

/** 两次 await 之间的取消点。 */
function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw abortError()
}

/**
 * 从 loader + agentPresets 读取探测配置。两个服务都可晚绑定/摘除；
 * 读取失败只影响探测候选，不抛给快照。
 */
export class McpProbeConfigReader implements ProbeConfigReaderFace {
  private loader: LoaderFace | undefined
  private presets: AgentPresetsFace | undefined

  constructor(services: { loader?: LoaderFace; presets?: AgentPresetsFace } = {}) {
    this.loader = services.loader
    this.presets = services.presets
  }

  attachServices(services: { loader?: LoaderFace; presets?: AgentPresetsFace }): void {
    if (services.loader !== undefined) this.loader = services.loader
    if (services.presets !== undefined) this.presets = services.presets
  }

  detachServices(names: readonly ('loader' | 'presets')[]): void {
    for (const name of names) {
      if (name === 'loader') this.loader = undefined
      if (name === 'presets') this.presets = undefined
    }
  }

  /**
   * 读取全部探测候选。`options.signal` 是协作取消：每次 await 之前检查，
   * 已取消即抛出（由调用方归一为 cancelled/unavailable）。
   */
  async collect(options: { signal?: AbortSignal } = {}): Promise<ProbeConfigCollection> {
    const signal = options.signal
    assertNotAborted(signal)
    const candidates: ProbeCandidate[] = []
    const profileResult = this.loader === undefined ? undefined : this.profileCandidates(this.loader)
    if (profileResult?.ok === true) candidates.push(...profileResult.candidates)
    const presetFace = this.presets
    const presetReadable =
      presetFace !== undefined && typeof presetFace.compositionInventory === 'function' && typeof presetFace.readDocument === 'function'
    let presets = false
    if (presetReadable && presetFace !== undefined) {
      const result = await this.presetCandidates(presetFace, signal)
      if (result.ok) candidates.push(...result.candidates)
      // 只有真正读到至少一份 preset 文档（或根本没有 preset）时才声明
      // presets 可读；readDocument 全失败绝不能冒充“已读取”。
      presets = result.ok && result.documentsReadable
    }
    const profile = profileResult?.ok === true
    assignProbeKeys(candidates)
    if (!profile && !presets) {
      return { candidates: [], available: false, profile: false, presets: false, reason: 'config_source_unavailable' }
    }
    return { candidates, available: true, profile, presets }
  }

  /** profile 根级 MCP 条目（顺序与 pluginInventory 的 loader 遍历一致）。 */
  private profileCandidates(loader: LoaderFace): { candidates: ProbeCandidate[]; ok: boolean } {
    const output: ProbeCandidate[] = []
    let entries: Iterable<unknown>
    try {
      entries = loader.entries()
    } catch {
      return { candidates: output, ok: false }
    }
    try {
      for (const raw of entries) {
        if (!isRecord(raw)) continue
        const entry = raw as {
          id?: unknown
          disabled?: unknown
          options?: { name?: unknown; config?: unknown; group?: unknown }
        }
        if (entry.options?.group === true) continue
        const moduleName = entry.options?.name
        if (typeof moduleName !== 'string' || !isMcpClientModule(moduleName)) continue
        const entryId = typeof entry.id === 'string' && entry.id !== '' ? entry.id : null
        const name = entryId ?? moduleName
        let disabled = true
        try {
          disabled = entry.disabled === true
        } catch {
          disabled = true
        }
        if (disabled) {
          // 禁用条目不是可探测候选：绝不解析/规整其 env/headers/command/url
          // （敏感字段只在真正需要发起探测时才求值）。
          output.push({
            probeKey: '',
            scope: 'profile',
            entryId,
            name,
            enabled: false,
            probeAvailable: false,
            probeUnavailableReason: 'disabled',
          })
          continue
        }
        const normalized = normalizeServerConfig(entry.options?.config)
        output.push({
          probeKey: '',
          scope: 'profile',
          entryId,
          name,
          enabled: true,
          probeAvailable: normalized.ok,
          ...(normalized.ok ? {} : { probeUnavailableReason: normalized.reason }),
          ...(normalized.ok ? { config: normalized.config } : {}),
        })
      }
    } catch {
      return { candidates: output, ok: false }
    }
    return { candidates: output, ok: true }
  }

  /**
   * preset 声明：inventory 状态 + readDocument YAML 配置。
   *
   * `documentsReadable` 只在真正读到至少一份可解析文档（或根本没有
   * preset 组合）时为 true —— readDocument 全失败不能声明 presets 可读。
   */
  private async presetCandidates(
    presets: AgentPresetsFace,
    signal: AbortSignal | undefined,
  ): Promise<{ candidates: ProbeCandidate[]; ok: boolean; documentsReadable: boolean }> {
    let compositions: readonly PluginInventoryPresetFace[]
    try {
      assertNotAborted(signal)
      compositions = await presets.compositionInventory!()
    } catch {
      return { candidates: [], ok: false, documentsReadable: false }
    }
    const output: ProbeCandidate[] = []
    let readDocuments = 0
    for (const composition of compositions) {
      assertNotAborted(signal)
      if (!isRecord(composition) || typeof composition.id !== 'string' || composition.id === '') continue
      const preset: McpPresetRef = {
        id: composition.id,
        ...(typeof composition.name === 'string' && composition.name !== '' ? { name: composition.name } : {}),
      }
      const inventoryRows = Array.isArray(composition.rows) ? composition.rows : []
      const broken = (typeof composition.broken === 'string' && composition.broken !== '') || !Array.isArray(composition.rows)
      let declared: DeclaredRow[] | undefined
      try {
        const document = await presets.readDocument!(composition.id)
        declared = typeof document?.content === 'string' ? parsePresetRows(document.content) : undefined
      } catch {
        declared = undefined
      }
      if (declared !== undefined) readDocuments += 1
      const used = new Set<number>()
      const length = declared?.length ?? inventoryRows.length
      for (let index = 0; index < length; index += 1) {
        const declaredRow = declared?.[index]
        const inventoryRow = matchInventoryRow(inventoryRows, index, declaredRow?.moduleName, declaredRow?.id, used)
        const moduleName = declaredRow?.moduleName ?? inventoryRow?.moduleName
        if (typeof moduleName !== 'string' || !isMcpClientModule(moduleName)) continue
        const entryId = inventoryRow !== undefined ? inventoryRow.entryId : (declaredRow?.id ?? null)
        const name = entryId ?? moduleName
        const enablement = evaluatePresetEnablement(inventoryRow, declaredRow?.disabled)
        const probeable = !broken && enablement.enabled && enablement.conditional !== true
        // 只有真正的可探测候选才规范敏感字段（disabled/conditional/broken
        // 条目的 env/headers/command/url 一律不求值、不保存）。
        const normalized = probeable
          ? declaredRow === undefined
            ? ({ ok: false, reason: 'config_missing' } as const)
            : normalizeServerConfig(declaredRow.config)
          : undefined
        const probeAvailable = probeable && normalized !== undefined && normalized.ok
        let reason: McpProbeUnavailableReason
        if (broken) reason = 'probe_unavailable'
        else if (enablement.conditional === true) reason = 'conditional'
        else if (!enablement.enabled) reason = enablement.reason ?? 'disabled'
        else if (normalized === undefined || normalized.ok) reason = 'probe_unavailable'
        else reason = normalized.reason
        output.push({
          probeKey: '',
          scope: 'preset',
          preset,
          entryId,
          name,
          enabled: enablement.enabled,
          ...(enablement.conditional ? { conditional: true as const } : {}),
          probeAvailable,
          ...(probeAvailable ? {} : { probeUnavailableReason: reason }),
          ...(probeAvailable && normalized !== undefined && normalized.ok ? { config: normalized.config } : {}),
        })
      }
    }
    return { candidates: output, ok: true, documentsReadable: compositions.length === 0 || readDocuments > 0 }
  }
}

/** 把 inventory 行按声明顺序匹配到 YAML 行（moduleName 一致才算同一行）。 */
function matchInventoryRow(
  rows: readonly PluginInventoryPresetRowFace[],
  index: number,
  moduleName: string | undefined,
  entryId: string | null | undefined,
  used: Set<number>,
): PluginInventoryPresetRowFace | undefined {
  if (entryId !== undefined && entryId !== null) {
    const byId = rows.findIndex((row, rowIndex) => !used.has(rowIndex) && row.entryId === entryId && (moduleName === undefined || row.moduleName === moduleName))
    if (byId >= 0) {
      used.add(byId)
      return rows[byId]
    }
  }
  const candidate = rows[index]
  if (candidate !== undefined && !used.has(index) && (moduleName === undefined || candidate.moduleName === moduleName)) {
    used.add(index)
    return candidate
  }
  const fallback = rows.findIndex((row, rowIndex) => !used.has(rowIndex) && row.moduleName === moduleName)
  if (fallback < 0) return undefined
  used.add(fallback)
  return rows[fallback]
}

function evaluatePresetEnablement(
  inventoryRow: PluginInventoryPresetRowFace | undefined,
  declaredDisabled: unknown,
): { enabled: boolean; conditional?: true; reason?: McpProbeUnavailableReason } {
  const state = inventoryRow?.enabled
  if (state === false) return { enabled: false, reason: 'disabled' }
  if (state === true) return { enabled: true }
  if (inventoryRow === undefined && (declaredDisabled === undefined || declaredDisabled === null || declaredDisabled === false)) {
    return { enabled: true }
  }
  // 'conditional'（或 inventory 行缺失）：只有纯 process.env 表达式能可靠求值。
  const condition = inventoryRow?.condition
  const expression = condition !== undefined ? { __jsExpr: condition } : declaredDisabled
  const evaluated = evaluateDisabled(expression)
  if (evaluated === false) return { enabled: false, reason: 'disabled' }
  if (evaluated === true) return { enabled: true }
  return { enabled: true, conditional: true, reason: 'conditional' }
}

/**
 * 分配稳定 probeKey：`profile:<id>` / `preset:<presetId>:<id>`。同一
 * profile/preset 内同名（含空 id 回退 moduleName）按声明顺序追加 `#n`，
 * 因此重复/空 id 不会互相覆盖；不同作用域的同名条目天然不同。
 */
function assignProbeKeys(candidates: ProbeCandidate[]): void {
  const groups = new Map<string, ProbeCandidate[]>()
  for (const candidate of candidates) {
    const group = candidate.scope === 'profile' ? 'profile' : `preset:${candidate.preset?.id ?? ''}`
    const list = groups.get(group)
    if (list === undefined) groups.set(group, [candidate])
    else list.push(candidate)
  }
  for (const list of groups.values()) {
    const counts = new Map<string, number>()
    for (const candidate of list) counts.set(candidate.name, (counts.get(candidate.name) ?? 0) + 1)
    const seen = new Map<string, number>()
    for (const candidate of list) {
      const occurrence = (seen.get(candidate.name) ?? 0) + 1
      seen.set(candidate.name, occurrence)
      const suffix = (counts.get(candidate.name) ?? 0) > 1 ? `#${String(occurrence)}` : ''
      candidate.probeKey = keyOf(candidate, suffix)
    }
  }
}

function keyOf(candidate: ProbeCandidate, suffix: string): string {
  if (candidate.scope === 'profile') return `profile:${encodeURIComponent(candidate.name)}${suffix}`
  return `preset:${encodeURIComponent(candidate.preset?.id ?? '')}:${encodeURIComponent(candidate.name)}${suffix}`
}

/**
 * 仅凭 inventory 条目计算展示用 probeKey（配置面不可读时的降级路径）。
 * 与完整配置读取使用同一命名，保证客户端回传的键至少可被识别为
 * “不可用目标”。
 */
export function probeKeyForEntry(scope: 'profile' | 'preset' | 'unknown', name: string, presetId?: string): string {
  if (scope === 'profile') return `profile:${encodeURIComponent(name)}`
  if (scope === 'preset' && presetId !== undefined) return `preset:${encodeURIComponent(presetId)}:${encodeURIComponent(name)}`
  return `managed:${encodeURIComponent(name)}`
}
