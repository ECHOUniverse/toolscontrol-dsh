/**
 * 独立、手动、短期的 MCP 连接探测运行时。
 *
 * 语义边界：
 * - 探测**不是** DSH 当前实例的实时连接状态。它只按配置建立一次短期
 *   连接、读取工具列表，然后关闭；不写任何配置、不注册工具、不影响
 *   `connectionStatus` / 条目 `status`。
 * - 只有显式 `probe()` 调用才会连接；快照路径绝不触发。
 * - 全局并发上限（默认 2）由 Host 单例执行，槽位只覆盖**连接**阶段；
 *   同一 `probeKey` 并发请求共享同一次底层操作（只连接一次）。
 * - 单条总预算默认 10 秒；`connect` 与 `listTools` 都携带同一个
 *   AbortSignal 与剩余超时，并在外层与该 signal 赛跑——即使 SDK 忽略
 *   signal，操作也能在预算内 settle。
 * - 取消是**调用者级**的：每个调用者有独立的本地取消/响应，只有最后
 *   一个仍关注该操作的调用者取消时才 abort 底层；中途退出的调用者立即
 *   拿到 `cancelled`，其余调用者照常拿结果。
 * - 配置收集有硬上界（默认 2 秒）、single-flight 与短 TTL 缓存（默认
 *   2 秒），批量探测共享一次读取；配置变化最多滞后一个 TTL。
 * - 成功/失败/取消/超时都可靠关闭 transport；close 有明确短上界（默认
 *   500ms），挂住的 close 绝不阻塞响应、并发槽位释放或 `dispose()`，
 *   后台 close 的错误全部被吞掉（禁止未处理拒绝）。
 * - 失败只返回固定分类与固定脱敏文案，原始错误绝不进入响应（原始错误
 *   可能含 URL、凭据或路径）。
 * - 托管路径（官方 `mcpManager.probe`）复用同一套槽位/预算/取消/dispose
 *   机制（`execute()`）；官方调用没有 AbortSignal，底层不可取消，因此只
 *   保证本地响应与槽位/dispose 语义正确。
 *
 * @module @hanxu131/toolscontrol-dsh/host/mcp-probe
 */

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { PLUGIN_VERSION, type McpEntryScope, type McpProbeFailure, type McpProbeResponse, type McpProbeStage } from '../shared/protocol.ts'
import type { ProbeCandidate, ProbeConfigCollection, ProbeConfigReaderFace, ProbeTransportConfig } from './mcp-config.ts'

/** 默认全局并发上限。 */
export const PROBE_MAX_CONCURRENT = 2
/** 单条探测总预算（毫秒）。 */
export const PROBE_TIMEOUT_MS = 10_000
/** 关闭连接的上界：close 挂住不得阻塞响应/槽位/dispose。 */
export const PROBE_CLOSE_TIMEOUT_MS = 500
/** 单次配置收集的硬上界（overview 与 probe 共用）。 */
export const PROBE_CONFIG_TIMEOUT_MS = 2_000
/** 配置收集结果的短缓存 TTL：批量探测共享一次读取，配置变化最多滞后该值。 */
export const PROBE_CONFIG_CACHE_MS = 2_000

/** 父环境剔除规则（与 DSH `scrubbedParentEnv` 同义）。 */
export const SENSITIVE_ENV_PATTERN = /KEY|PASSWORD|SECRET|TOKEN/i

/**
 * DSH `@deepseek-ai/dsh-http-proxy` 发布的代理环境名（`POLICY_ENV_NAMES`）：
 * lowercase 在前，两种大小写总是一起写或一起清。
 */
const PROXY_ENV_FIELDS = {
  httpProxy: ['http_proxy', 'HTTP_PROXY'],
  httpsProxy: ['https_proxy', 'HTTPS_PROXY'],
  noProxy: ['no_proxy', 'NO_PROXY'],
} as const

/** 代理 URL 是否可被官方策略接受（`http:`/`https:`；SOCKS 等一律拒绝）。 */
function isSupportedProxyUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * 复刻 DSH `@deepseek-ai/dsh-http-proxy` 的 `proxyEnvironmentForChild()`
 * 覆盖层语义：把父进程当前的代理变量规范化成子进程需要的一份覆盖
 * （两种大小写同名同值），并在有可用的 http(s) 代理时补上
 * `NODE_USE_ENV_PROXY=1`，让 Node 子进程与父进程走同一条路由。
 *
 * 官方实现会从内部策略对象取“解析结果 + 用户原始写法”；本插件没有该
 * 包的依赖（也不允许新增依赖），因此只能读取父进程环境——而官方策略
 * 恰恰已把解析结果**写回**这组变量，所以父环境里的值就是父进程实际
 * 使用的路由。两点已知差异（都不影响安全边界）：
 * - 官方会把“用户导出但被策略拒绝”的写法（如 `socks5:`）还原给
 *   curl 之类的非 Node 子进程；该原值在发布后已不在进程环境里，本实现
 *   无法还原，按父进程的最终值（通常已移除）处理。
 * - 官方在“策略为 none”时返回 `{}`；本实现无法区分“未安装策略”与
 *   “策略恰好与用户导出的变量一致”，只能在存在可用代理变量时补标志。
 *
 * @param parent - 父进程环境（默认 `process.env`，测试可注入）。
 * @returns 覆盖层；`undefined` 表示应从子环境移除该名。
 */
export function proxyEnvironmentForChild(parent: NodeJS.ProcessEnv = process.env): Record<string, string | undefined> {
  const overlay: Record<string, string | undefined> = {}
  let proxied = false
  for (const field of ['httpProxy', 'httpsProxy', 'noProxy'] as const) {
    const names = PROXY_ENV_FIELDS[field]
    const value = names.map((name) => parent[name]).find((candidate) => candidate !== undefined && candidate !== '')
    for (const name of names) overlay[name] = value
    if (field !== 'noProxy' && value !== undefined) proxied = true
  }
  if (!proxied) return {}
  overlay.NODE_USE_ENV_PROXY = '1'
  // 与官方一致：任一 http(s) 代理名不是受支持的 URL 时不发标志，否则
  // Node 会在运行程序前解析失败并直接退出。
  for (const field of ['httpProxy', 'httpsProxy'] as const) {
    const value = overlay[PROXY_ENV_FIELDS[field][0]]
    if (value !== undefined && !isSupportedProxyUrl(value)) {
      delete overlay.NODE_USE_ENV_PROXY
      break
    }
  }
  return overlay
}

/**
 * 复刻 DSH `dsh-subprocess` 的 `scrubbedParentEnv`：剔除名字匹配敏感模式
 * 与 `DSH_*` 的父环境变量，应用代理覆盖层（`undefined` = 移除），再用
 * 配置显式 env 覆盖。stdio 子进程只看到这份环境。
 */
export function buildScrubbedChildEnv(
  extra: Record<string, string>,
  parent: NodeJS.ProcessEnv = process.env,
  overlay: Record<string, string | undefined> = proxyEnvironmentForChild(parent),
): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(parent)) {
    if (value === undefined) continue
    if (SENSITIVE_ENV_PATTERN.test(key)) continue
    if (key.toUpperCase().startsWith('DSH_')) continue
    env[key] = value
  }
  for (const [name, value] of Object.entries(overlay)) {
    if (value === undefined) delete env[name]
    else env[name] = value
  }
  return { ...env, ...extra }
}

/** 一次探测连接的生命周期（真实 SDK 或测试替身）。 */
export interface ProbeSession {
  connect(options: { signal: AbortSignal; timeout: number }): Promise<void>
  /** 无 tools 能力时必须返回 `{ supported: false, names: [] }`。 */
  listTools(options: { signal: AbortSignal; timeout: number }): Promise<{ supported: boolean; names: string[] }>
  /** 必须幂等，并在 connect 失败后仍能关闭 transport/子进程。 */
  close(): Promise<void>
  /**
   * 立即打断进行中的协商（关闭 transport，回收 stdio sibling）。可选：
   * 未实现时探测只依赖外层 signal race 与有界 close。多次调用必须幂等。
   */
  cancel?(): void | Promise<void>
}

/** 由配置创建连接会话（测试可注入，绝不启动真实进程/网络）。 */
export type ProbeConnector = (config: ProbeTransportConfig) => ProbeSession

/**
 * 真实 SDK 会话：连接 + 工具列表 + 双保险关闭。
 *
 * 关闭顺序：已连接时先 `client.close()`；无论成功与否都再
 * `transport.close()`。SDK 的 stdio transport 会按 stdin → SIGTERM →
 * SIGKILL 逐级回收子进程，因此 connect 失败也不会留下进程。
 *
 * `cancel()` 直接关 transport：协商（`initialize`）挂在 transport 的读写
 * 上，关掉它就能立刻打断协商并回收 stdio sibling，不必等 SDK 自己响应
 * AbortSignal。`close()`/`cancel()` 都幂等。
 */
class SdkProbeSession implements ProbeSession {
  private readonly client: Client
  private readonly transport: StreamableHTTPClientTransport | StdioClientTransport
  private closing: Promise<void> | undefined
  private cancelling: Promise<void> | undefined

  constructor(config: ProbeTransportConfig) {
    this.client = new Client(
      { name: 'toolscontrol-dsh-probe', version: PLUGIN_VERSION },
      { capabilities: {}, versionNegotiation: { mode: 'auto' } },
    )
    if (config.transport === 'stdio') {
      this.transport = new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: buildScrubbedChildEnv(config.env),
        // 探测是短期只读连接：子进程 stderr 不继承到 Host 日志，避免服务端
        // 自行打印的凭据/路径进入日志；诊断只经由脱敏后的安全 code 返回。
        stderr: 'ignore',
        ...(config.cwd !== undefined ? { cwd: config.cwd } : {}),
      })
    } else {
      this.transport = new StreamableHTTPClientTransport(new URL(config.url), {
        requestInit: { headers: config.headers },
      })
    }
  }

  async connect(options: { signal: AbortSignal; timeout: number }): Promise<void> {
    await this.client.connect(this.transport, { signal: options.signal, timeout: options.timeout })
  }

  async listTools(options: { signal: AbortSignal; timeout: number }): Promise<{ supported: boolean; names: string[] }> {
    // 服务端未声明 tools 能力：按成功 0 工具处理，不猜测工具列表。
    if (this.client.getServerCapabilities()?.tools === undefined) return { supported: false, names: [] }
    const result = await this.client.listTools(undefined, {
      signal: options.signal,
      timeout: options.timeout,
      cacheMode: 'refresh',
    })
    return { supported: true, names: result.tools.map((tool) => tool.name) }
  }

  cancel(): void {
    // 只关 transport：这是打断协商并回收 stdio sibling 的最短路径。
    // 失败由随后的有界 close 兜底，绝不让拒绝逃逸。
    this.cancelling ??= (async (): Promise<void> => {
      try {
        await this.transport.close()
      } catch {
        // 协商期关闭失败不影响取消语义。
      }
    })()
  }

  async close(): Promise<void> {
    // 无论 connect 是否成功都尝试两段关闭：client.close 负责协议状态，
    // transport.close 负责 stdio 子进程/HTTP 流；任一段失败都不跳过另一段。
    this.closing ??= (async (): Promise<void> => {
      try {
        await this.client.close()
      } catch {
        // 关闭失败不能让 transport 回收被跳过。
      }
      try {
        await this.transport.close()
      } catch {
        // 已关闭/传输损坏时 close 可能抛错；探测结果不回传该错误。
      }
    })()
    await this.closing
  }
}

/** 默认真实连接器：使用固定版本 `@modelcontextprotocol/client@2.2.0`。 */
const sdkConnector: ProbeConnector = (config) => new SdkProbeSession(config)

/** 探测运行时可注入项（测试用）。 */
export interface McpProbeRuntimeOptions {
  maxConcurrent?: number
  timeoutMs?: number
  /** 有界关闭的上界（毫秒）。 */
  closeTimeoutMs?: number
  /** 单次配置收集的硬上界（毫秒）。 */
  configTimeoutMs?: number
  /** 配置收集缓存 TTL（毫秒）。 */
  configCacheMs?: number
  connector?: ProbeConnector
  now?: () => number
}

interface ProbeIdentity {
  scope?: McpEntryScope
  presetId?: string
  entryId?: string | null
}

interface Waiter {
  grant(): void
  cancel(): void
}

/** 单次底层探测操作的共享状态（调用者各自加入/退出）。 */
interface Operation {
  readonly controller: AbortController
  readonly startedAt: number
  /** 仍在等待该操作的调用者数量。 */
  interested: number
  /** 底层操作是否已 settle。 */
  settled: boolean
  promise: Promise<McpProbeResponse> | undefined
}

/**
 * 一次操作内可用的预算/取消视图（独立探测与托管探测共用）。
 * `race()` 让忽略 signal 的底层实现也能在预算内 settle。
 */
export interface ProbeBudget {
  readonly signal: AbortSignal
  /** 剩余毫秒（`<= 0` 表示预算已耗尽）。 */
  remaining(): number
  /** 是否因预算耗尽而超时（而非调用者取消）。 */
  timedOut(): boolean
  /** 自操作开始以来的毫秒数。 */
  elapsed(): number
  /** 已取消/已耗尽时的安全 stage。 */
  abortStage(): 'timeout' | 'cancelled'
  /** 与 signal 赛跑：底层忽略 signal 也能 settle。 */
  race<T>(work: Promise<T>): Promise<T>
  /**
   * 占用一个全局并发槽；取消/超时导致拿不到槽时返回 `undefined`。
   * 返回的 release 必须（且只会）在本地 settle 时调用一次——即使底层
   * 传输不可取消，槽位也不会被它永久占用。
   */
  acquireSlot(): Promise<(() => void) | undefined>
}

class ProbeAbortError extends Error {
  constructor() {
    super('probe operation aborted')
    this.name = 'AbortError'
  }
}

function abortError(): Error {
  return new ProbeAbortError()
}

function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError'
}

/** 与 AbortSignal 赛跑；被丢下的 work 的 settle 已被接住（无未处理拒绝）。 */
function raceWithSignal<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError())
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(abortError())
    signal.addEventListener('abort', onAbort, { once: true })
    work.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

/** 独立探测服务：并发限制、同键去重、超时/取消与可靠关闭。 */
export class McpProbeService {
  readonly maxConcurrent: number
  readonly timeoutMs: number
  private readonly reader: ProbeConfigReaderFace
  private readonly connector: ProbeConnector
  private readonly now: () => number
  private readonly closeTimeoutMs: number
  private readonly configTimeoutMs: number
  private readonly configCacheMs: number
  private readonly inFlight = new Map<string, Operation>()
  private readonly waiters: Waiter[] = []
  /** 后台有界 close；错误已在内部吞掉，永不 reject。 */
  private readonly closing = new Set<Promise<void>>()
  private collectCache: { at: number; promise: Promise<ProbeConfigCollection> } | undefined
  private disposePromise: Promise<void> | undefined
  private active = 0
  private disposed = false

  constructor(reader: ProbeConfigReaderFace, options: McpProbeRuntimeOptions = {}) {
    this.reader = reader
    this.maxConcurrent = options.maxConcurrent ?? PROBE_MAX_CONCURRENT
    this.timeoutMs = options.timeoutMs ?? PROBE_TIMEOUT_MS
    this.closeTimeoutMs = options.closeTimeoutMs ?? PROBE_CLOSE_TIMEOUT_MS
    this.configTimeoutMs = options.configTimeoutMs ?? PROBE_CONFIG_TIMEOUT_MS
    this.configCacheMs = options.configCacheMs ?? PROBE_CONFIG_CACHE_MS
    this.connector = options.connector ?? sdkConnector
    this.now = options.now ?? Date.now
  }

  /**
   * 显式探测一个 probeKey：同一 probeKey 的并发调用共享同一次底层连接，
   * 但每个调用者都有独立的取消与响应。
   */
  probe(probeKey: string, options: { signal?: AbortSignal } = {}): Promise<McpProbeResponse> {
    return this.execute(probeKey, options, (budget) => this.runProbe(probeKey, budget))
  }

  /**
   * 在一个受统一预算/并发/取消/dispose 治理的槽位里执行任意探测体
   * （托管路径 `mcpManager.probe` 复用同一套限制，不再绕过）。
   */
  execute(
    probeKey: string,
    options: { signal?: AbortSignal },
    body: (budget: ProbeBudget) => Promise<McpProbeResponse>,
  ): Promise<McpProbeResponse> {
    if (this.disposed) {
      return Promise.resolve(this.failure(probeKey, 'unavailable', '探测服务已关闭', 0))
    }
    const signal = options.signal
    if (signal?.aborted === true) {
      return Promise.resolve(this.failure(probeKey, 'cancelled', '探测已取消', 0))
    }
    let operation = this.inFlight.get(probeKey)
    if (operation === undefined) {
      const created: Operation = {
        controller: new AbortController(),
        startedAt: this.now(),
        interested: 0,
        settled: false,
        promise: undefined,
      }
      created.promise = this.runOperation(created, probeKey, body)
      this.inFlight.set(probeKey, created)
      operation = created
    }
    return this.join(operation, probeKey, signal)
  }

  /**
   * 读取探测配置（single-flight + 短 TTL + 硬上界）。overview 与批量探测
   * 共享同一次读取；超时 reject，调用方自行降级为“探测不可用”。
   */
  collectConfig(): Promise<ProbeConfigCollection> {
    if (this.disposed) return Promise.reject(new Error('probe service disposed'))
    const at = this.now()
    const cached = this.collectCache
    if (cached !== undefined && at - cached.at <= this.configCacheMs) return cached.promise
    const entry: { at: number; promise: Promise<ProbeConfigCollection> } = { at, promise: this.collectOnce() }
    this.collectCache = entry
    // 失败不入缓存：短暂的读取失败应能立即重试。
    entry.promise.catch(() => {
      if (this.collectCache === entry) this.collectCache = undefined
    })
    return entry.promise
  }

  /** 服务/配置面变化时显式失效（避免 TTL 内复用旧清单）。 */
  invalidateConfig(): void {
    this.collectCache = undefined
  }

  /**
   * 插件 dispose：中止所有在途探测、等待其 settle 与后台 close。
   * 并发调用返回**同一个** Promise，绝不提前返回。
   */
  dispose(): Promise<void> {
    this.disposePromise ??= this.shutdown()
    return this.disposePromise
  }

  private async shutdown(): Promise<void> {
    this.disposed = true
    this.invalidateConfig()
    for (const operation of [...this.inFlight.values()]) operation.controller.abort()
    for (const waiter of [...this.waiters]) waiter.cancel()
    const pending: Promise<McpProbeResponse>[] = []
    for (const operation of this.inFlight.values()) {
      if (operation.promise !== undefined) pending.push(operation.promise)
    }
    await Promise.allSettled(pending)
    // 每个后台 close 自身带上界（closeTimeoutMs），因此这里不会无界等待。
    await Promise.allSettled([...this.closing])
  }

  /** 每个调用者独立的等待句柄：本地取消立即返回，最后一个退出者才 abort 底层。 */
  private join(operation: Operation, probeKey: string, signal: AbortSignal | undefined): Promise<McpProbeResponse> {
    operation.interested += 1
    return new Promise<McpProbeResponse>((resolve) => {
      let done = false
      const onAbort = (): void => {
        finish(this.failure(probeKey, 'cancelled', '探测已取消', this.elapsed(operation.startedAt)))
        if (operation.interested <= 0 && !operation.settled) operation.controller.abort()
      }
      const finish = (response: McpProbeResponse): void => {
        if (done) return
        done = true
        signal?.removeEventListener('abort', onAbort)
        operation.interested = Math.max(0, operation.interested - 1)
        resolve(response)
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      const shared = operation.promise
      if (shared === undefined) {
        finish(this.failure(probeKey, 'unavailable', '当前 Host 无法完成该探测', 0))
        return
      }
      shared.then(
        (response) => finish(response),
        () => finish(this.failure(probeKey, 'unavailable', '当前 Host 无法完成该探测', this.elapsed(operation.startedAt))),
      )
      // 注册监听与检查之间可能已经 abort（外部 signal 的竞态窗口）。
      if (signal?.aborted === true) onAbort()
    })
  }

  /** 底层操作：预算计时器 + abort + settle 后清理 inFlight。 */
  private async runOperation(
    operation: Operation,
    probeKey: string,
    body: (budget: ProbeBudget) => Promise<McpProbeResponse>,
  ): Promise<McpProbeResponse> {
    const controller = operation.controller
    const startedAt = operation.startedAt
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, this.timeoutMs)
    timer.unref()
    const budget: ProbeBudget = {
      signal: controller.signal,
      remaining: () => Math.max(0, startedAt + this.timeoutMs - this.now()),
      timedOut: () => timedOut,
      elapsed: () => this.elapsed(startedAt),
      abortStage: () => (timedOut || this.now() >= startedAt + this.timeoutMs ? 'timeout' : 'cancelled'),
      race: (work) => raceWithSignal(work, controller.signal),
      acquireSlot: async () => {
        const granted = await this.acquire(controller.signal)
        if (!granted) return undefined
        let released = false
        return () => {
          if (released) return
          released = true
          this.release()
        }
      },
    }
    let response: McpProbeResponse
    try {
      response = await body(budget)
    } catch {
      // 探测体内部已把已知失败归一；这里只兜底未预期抛出（不回传原始错误）。
      const stage = budget.signal.aborted
        ? budget.abortStage()
        : ('unavailable' as const)
      response = this.failure(probeKey, stage, this.stageMessage(stage), budget.elapsed())
    } finally {
      clearTimeout(timer)
      operation.settled = true
      if (this.inFlight.get(probeKey) === operation) this.inFlight.delete(probeKey)
    }
    return response
  }

  /** 单条独立探测体：配置候选 → 连接 → 工具列表（共享预算/取消）。 */
  private async runProbe(probeKey: string, budget: ProbeBudget): Promise<McpProbeResponse> {
    const { signal } = budget
    let identity: ProbeIdentity = {}
    const abortResponse = (): McpProbeResponse => this.abortFailure(probeKey, budget, identity)
    let collection: ProbeConfigCollection
    try {
      collection = await budget.race(this.collectConfig())
    } catch {
      if (signal.aborted) return abortResponse()
      return this.failure(probeKey, 'unavailable', '当前 Host 无法读取 MCP 探测配置', budget.elapsed(), identity)
    }
    if (signal.aborted) return abortResponse()
    if (!collection.available) {
      return this.failure(probeKey, 'unavailable', '当前 Host 没有可用的 MCP 配置读取面', budget.elapsed(), identity)
    }
    const candidate = collection.candidates.find((item) => item.probeKey === probeKey)
    if (candidate === undefined) {
      return this.failure(probeKey, 'unavailable', '未找到该探测键对应的条目（配置可能已变化）', budget.elapsed(), identity)
    }
    identity = identityOf(candidate)
    if (!candidate.probeAvailable) {
      const reason = candidate.probeUnavailableReason ?? 'probe_unavailable'
      if (reason === 'disabled') {
        return this.failure(probeKey, 'disabled', '该条目标记为未启用，不能探测', budget.elapsed(), identity)
      }
      return this.failure(probeKey, 'unavailable', unavailableMessage(reason), budget.elapsed(), identity)
    }
    if (candidate.config === undefined) {
      return this.failure(probeKey, 'unavailable', unavailableMessage('config_missing'), budget.elapsed(), identity)
    }
    if (signal.aborted) return abortResponse()

    // 并发槽只覆盖真正的连接阶段：配置读取（shared、有上界）不占槽位。
    const releaseSlot = await budget.acquireSlot()
    if (releaseSlot === undefined) return abortResponse()
    let session: ProbeSession | undefined
    let onCancel: (() => void) | undefined
    try {
      if (signal.aborted) return abortResponse()
      try {
        session = this.connector(candidate.config)
      } catch {
        return this.failure(probeKey, 'connect', '连接 MCP 服务器失败', budget.elapsed(), identity)
      }
      const activeSession = session
      // abort 时立即打断协商并回收 stdio sibling（不依赖 SDK 是否响应 signal）。
      onCancel = (): void => {
        this.cancelSession(activeSession)
      }
      signal.addEventListener('abort', onCancel, { once: true })
      let toolNames: string[]
      let phase: 'connect' | 'tools_list' = 'connect'
      try {
        await budget.race(activeSession.connect({ signal, timeout: this.callTimeout(budget) }))
        if (signal.aborted) return abortResponse()
        if (budget.remaining() <= 0) return this.expiredFailure(probeKey, budget, identity)
        phase = 'tools_list'
        const listed = await budget.race(activeSession.listTools({ signal, timeout: this.callTimeout(budget) }))
        toolNames = Array.isArray(listed.names) ? listed.names.map((name) => String(name)) : []
      } catch (error) {
        const code = this.classify(error, budget.timedOut(), signal, phase, budget.remaining())
        return this.failure(probeKey, code, this.stageMessage(code), budget.elapsed(), identity)
      }
      // 防御：connect/listTools 之后超预算（或已取消）绝不返回 success。
      if (signal.aborted) return abortResponse()
      if (budget.remaining() <= 0) return this.expiredFailure(probeKey, budget, identity)
      return {
        ok: true,
        probeKey,
        scope: candidate.scope,
        ...(candidate.preset !== undefined ? { presetId: candidate.preset.id } : {}),
        entryId: candidate.entryId,
        probedAt: this.now(),
        durationMs: budget.elapsed(),
        toolNames,
        toolCount: toolNames.length,
      }
    } finally {
      if (onCancel !== undefined) signal.removeEventListener('abort', onCancel)
      // 关闭是后台的、有界的：绝不阻塞结果、槽位释放或 dispose。
      if (session !== undefined) this.scheduleClose(session)
      releaseSlot()
    }
  }

  /** 配置收集：single-flight + 硬上界（timeoutMs 上限内的协作取消）。 */
  private collectOnce(): Promise<ProbeConfigCollection> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.configTimeoutMs)
    timer.unref()
    const work = (async (): Promise<ProbeConfigCollection> => this.reader.collect({ signal: controller.signal }))()
    const raced = raceWithSignal(work, controller.signal)
    const settle = (): void => {
      clearTimeout(timer)
    }
    raced.then(settle, settle)
    return raced
  }

  /** 后台有界 close：`close()` 永不 reject，且最多等待 closeTimeoutMs。 */
  private scheduleClose(session: ProbeSession): void {
    const bounded = this.closeBounded(session).then(() => {
      this.closing.delete(bounded)
    })
    this.closing.add(bounded)
  }

  private closeBounded(session: ProbeSession): Promise<void> {
    const close = (async (): Promise<void> => {
      try {
        await session.close()
      } catch {
        // 关闭错误不覆盖已确定的探测结果，也不进入日志/响应。
      }
    })()
    return new Promise<void>((resolve) => {
      let done = false
      let timer: ReturnType<typeof setTimeout> | undefined
      const finish = (): void => {
        if (done) return
        done = true
        if (timer !== undefined) clearTimeout(timer)
        resolve()
      }
      timer = setTimeout(finish, this.closeTimeoutMs)
      timer.unref()
      close.then(finish, finish)
    })
  }

  /** abort 时立即打断协商；失败不冒泡（随后的有界 close 兜底）。 */
  private cancelSession(session: ProbeSession): void {
    if (session.cancel === undefined) return
    try {
      void Promise.resolve(session.cancel()).catch(() => {
        // 取消失败不影响结果语义。
      })
    } catch {
      // 同步抛出同样吞掉：不进入响应/日志。
    }
  }

  private callTimeout(budget: ProbeBudget): number {
    const remaining = budget.remaining()
    return remaining > 0 ? remaining : 1
  }

  private expiredFailure(probeKey: string, budget: ProbeBudget, identity: ProbeIdentity): McpProbeFailure {
    return this.failure(probeKey, 'timeout', this.timeoutMessage(), budget.elapsed(), identity)
  }

  private abortFailure(probeKey: string, budget: ProbeBudget, identity: ProbeIdentity): McpProbeFailure {
    const stage = budget.abortStage()
    return this.failure(probeKey, stage, this.stageMessage(stage), budget.elapsed(), identity)
  }

  private classify(
    error: unknown,
    timedOut: boolean,
    signal: AbortSignal,
    phase: 'connect' | 'tools_list',
    remaining: number,
  ): McpProbeStage {
    if (timedOut || remaining <= 0) return 'timeout'
    if (signal.aborted) return 'cancelled'
    if (isAbortError(error)) return 'cancelled'
    const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined
    if (code === 'REQUEST_TIMEOUT' || code === 'ETIMEDOUT') return 'timeout'
    const name = typeof error === 'object' && error !== null ? (error as { name?: unknown }).name : undefined
    if (name === 'TimeoutError') return 'timeout'
    return phase
  }

  private stageMessage(code: McpProbeStage): string {
    switch (code) {
      case 'timeout':
        return this.timeoutMessage()
      case 'cancelled':
        return '探测已取消'
      case 'unavailable':
        return '当前 Host 无法完成该探测'
      case 'disabled':
        return '该条目标记为未启用，不能探测'
      case 'tools_list':
        return '已连接，但读取工具列表失败'
      case 'connect':
      default:
        return '连接 MCP 服务器失败'
    }
  }

  private timeoutMessage(): string {
    return `探测超时（${String(this.timeoutMs)} 毫秒）`
  }

  private failure(
    probeKey: string,
    code: McpProbeStage,
    message: string,
    durationMs: number,
    identity: ProbeIdentity = {},
  ): McpProbeFailure {
    return {
      ok: false,
      probeKey,
      ...(identity.scope !== undefined ? { scope: identity.scope } : {}),
      ...(identity.presetId !== undefined ? { presetId: identity.presetId } : {}),
      ...(identity.entryId !== undefined ? { entryId: identity.entryId } : {}),
      stage: code,
      code,
      message,
      durationMs,
    }
  }

  private elapsed(startedAt: number): number {
    return Math.max(0, this.now() - startedAt)
  }

  /** FIFO 并发闸门；排队期间可被取消/超时。 */
  private acquire(signal: AbortSignal): Promise<boolean> {
    if (signal.aborted) return Promise.resolve(false)
    if (this.active < this.maxConcurrent) {
      this.active += 1
      return Promise.resolve(true)
    }
    return new Promise<boolean>((resolve) => {
      let settled = false
      const cleanup = (): void => {
        const index = this.waiters.indexOf(waiter)
        if (index >= 0) this.waiters.splice(index, 1)
        signal.removeEventListener('abort', onAbort)
      }
      const finish = (granted: boolean): void => {
        if (settled) return
        settled = true
        cleanup()
        resolve(granted)
      }
      const waiter: Waiter = {
        grant: () => finish(true),
        cancel: () => finish(false),
      }
      const onAbort = (): void => finish(false)
      this.waiters.push(waiter)
      signal.addEventListener('abort', onAbort, { once: true })
      if (signal.aborted) finish(false)
    })
  }

  private release(): void {
    const next = this.waiters.shift()
    if (next !== undefined) next.grant()
    else this.active = Math.max(0, this.active - 1)
  }
}

function identityOf(candidate: ProbeCandidate): ProbeIdentity {
  return {
    scope: candidate.scope,
    ...(candidate.preset !== undefined ? { presetId: candidate.preset.id } : {}),
    entryId: candidate.entryId,
  }
}

function unavailableMessage(reason: NonNullable<ProbeCandidate['probeUnavailableReason']>): string {
  switch (reason) {
    case 'disabled':
      return '该条目标记为未启用，不能探测'
    case 'conditional':
      return '该条目的启用条件依赖无法可靠求值的表达式，不能探测'
    case 'config_missing':
      return '该条目没有可读取的传输配置'
    case 'config_unresolved':
      return '该条目的配置表达式无法在 Host 内可靠求值'
    case 'unsupported_transport':
      return '该条目的传输方式不受支持'
    case 'probe_unavailable':
    default:
      return '当前 Host 无法探测该条目'
  }
}
