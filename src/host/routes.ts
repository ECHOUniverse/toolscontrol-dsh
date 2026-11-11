/**
 * Host 路由表：`/toolscontrol` 命名空间上的只读处理器。
 *
 * 每个处理器遵循官方自定义路由契约（与 `@deepseek-ai/dsh-host-open-in-app`
 * 同形）：仅 `health` 公开（只含插件标识）；其余路由先过官方
 * `ctx.connection.requestRejection` 信任门（认证 + Host/Origin/
 * `sec-fetch-site` 信任），再过方法门；带体的路由另过 `application/json`
 * 媒体类型门与有界体读取。处理器只做参数校验、调用 `OverviewService`
 * 门面并序列化 `shared/protocol.ts` wire 类型。
 *
 * 安全红线：无任何写配置/写文件路由；probe 只按名称显式触发。
 *
 * @module @hanxu131/toolscontrol-dsh/host/routes
 */

import {
  PLUGIN_NAME,
  PLUGIN_VERSION,
  ROUTE_BASE,
  ROUTES,
  type HealthResponse,
  type OverviewSnapshot,
} from '../shared/protocol.ts'
import type { ConnectionFace, WebServerFace } from './services.ts'
import {
  readJsonObject,
  rejectUntrusted,
  sendError,
  sendJson,
  sendMethodNotAllowed,
  sendUnknownError,
  type RouteRequest,
  type RouteResponse,
} from './respond.ts'
import type { OverviewService } from './inventory.ts'

export interface RouteDeps {
  overview: OverviewService
  /** Official connection trust fence; protected routes answer 503 without it. */
  connection?: ConnectionFace
}

/** 请求体上限（probe 只带一个名称，64 KiB 绰绰有余）。 */
const MAX_JSON_BODY_BYTES = 64 * 1024
/** cwd 参数长度上限（文件系统路径预算）。 */
const MAX_CWD_LENGTH = 4096
/** sessionId 参数长度上限（官方 SessionId 的长度预算）。 */
const MAX_SESSION_ID_LENGTH = 256
/** probeKey 长度上限（scope/presetId/entryId 编码后的预算）。 */
const MAX_PROBE_KEY_LENGTH = 512

/** 在组合 webServer 上注册整张路由表，返回注销函数。 */
export function registerRoutes(webServer: WebServerFace, deps: RouteDeps): () => void {
  const { overview } = deps

  return webServer.register({
    kind: 'prefix',
    path: ROUTE_BASE,
    handler: async (req: RouteRequest, res: RouteResponse) => {
      // 畸形 req.url 会让 new URL 抛出——在主 try 之外单独拦截，统一答
      // 400 JSON 包络，处理器绝不向调用方抛出。
      let url: URL
      try {
        url = new URL(String(req.url ?? '/'), 'http://dsh.invalid')
      } catch {
        return sendError(res, 400, 'invalid_input', 'request URL is malformed')
      }
      const pathname = url.pathname
      const method = String(req.method ?? 'GET').toUpperCase()
      try {
        // ------------------------------------------------- public: health
        if (pathname === ROUTES.health) {
          if (method !== 'GET') return sendMethodNotAllowed(res, 'GET')
          // Minimal-public: plugin identity only, never overview data.
          const body: HealthResponse = { ok: true, plugin: PLUGIN_NAME, version: PLUGIN_VERSION }
          return sendJson(res, 200, body)
        }

        // --------------------------------- protected: official trust fence
        if (rejectUntrusted(req, res, deps.connection)) return

        // ------------------------------------------------------- overview
        if (pathname === ROUTES.overview) {
          if (method !== 'GET') return sendMethodNotAllowed(res, 'GET')
          const cwd = cwdParamOf(url)
          if (cwd === null) return sendError(res, 400, 'invalid_input', 'cwd must be an absolute filesystem path')
          const sessionId = sessionIdParamOf(url)
          if (sessionId === null) {
            return sendError(res, 400, 'invalid_input', 'sessionId must be a non-empty session identifier (max 256 chars)')
          }
          const snapshot: OverviewSnapshot = await overview.snapshot(cwd ?? undefined, sessionId)
          return sendJson(res, 200, snapshot)
        }

        // ------------------------------------------- explicit MCP probe
        if (pathname === ROUTES.probe) {
          if (method !== 'POST') return sendMethodNotAllowed(res, 'POST')
          // 断连监听必须在读取请求体**之前**建立：body 尚未读完时客户端
          // 就可能已经断开（大 body / 慢客户端）。整个分支共用同一个
          // signal，任何早退都在 finally 里注销监听。
          const abort = requestAbortSignal(req, res)
          try {
            const body = await readJsonObject(req, res, MAX_JSON_BODY_BYTES)
            if (body === null) return
            // body 读完后已断开：绝不发起探测，也不向已关闭的响应写入。
            if (abort.signal.aborted) return
            const probeKey = body.probeKey
            if (typeof probeKey === 'string' && probeKey.trim() !== '') {
              if (probeKey.length > MAX_PROBE_KEY_LENGTH) {
                return sendError(res, 400, 'invalid_input', `probeKey must be at most ${MAX_PROBE_KEY_LENGTH} chars`)
              }
              // 业务结果（含 ok:false 的不可用/失败语义）以 200 承载；客户端按 ok 分支。
              return sendJson(res, 200, await overview.probeByKey(probeKey, { signal: abort.signal }))
            }
            const server = body.server
            if (typeof server !== 'string' || server.trim() === '' || server.length > 256) {
              return sendError(res, 400, 'invalid_input', 'probeKey must be a non-empty string (or legacy server name, max 256 chars)')
            }
            return sendJson(res, 200, await overview.probe(server, { signal: abort.signal }))
          } finally {
            abort.dispose()
          }
        }

        return sendError(res, 404, 'not_found', `No route ${method} ${pathname}`)
      } catch (error) {
        if (!res.writableEnded && !res.headersSent) sendUnknownError(res, error)
        else if (!res.writableEnded) res.end()
      }
    },
  })
}

/** 监听请求/响应中断，给显式探测提供一个可取消的 AbortSignal。 */
function requestAbortSignal(req: RouteRequest, res: RouteResponse): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController()
  const onAborted = (): void => controller.abort()
  const onClose = (): void => {
    if (!res.writableEnded) controller.abort()
  }
  const reqEvents = req as unknown as { once?: (event: string, listener: () => void) => void; off?: (event: string, listener: () => void) => void }
  const resEvents = res as unknown as { once?: (event: string, listener: () => void) => void; off?: (event: string, listener: () => void) => void }
  reqEvents.once?.('aborted', onAborted)
  resEvents.once?.('close', onClose)
  return {
    signal: controller.signal,
    dispose: () => {
      reqEvents.off?.('aborted', onAborted)
      resEvents.off?.('close', onClose)
    },
  }
}

/**
 * 校验 `cwd` 查询参数：必须是绝对文件系统路径（POSIX `/` 或 Windows 盘符
 * 形式），无 NUL、不超长。合法但缺失时返回 `undefined`（全局视图）；
 * 非法返回 `null`（由调用方答 400）。路径只用于拼接已确认的 Skills
 * 根目录（`<cwd>/.dsh/skills` 等），不做任意目录递归。
 */
function cwdParamOf(url: URL): string | undefined | null {
  const raw = url.searchParams.get('cwd')
  if (raw === null || raw === '') return undefined
  if (raw.length > MAX_CWD_LENGTH) return null
  if (raw.includes('\0')) return null
  if (!raw.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(raw)) return null
  return raw
}

/**
 * 校验 `sessionId` 查询参数：官方会话标识（不透明字符串）。空值视为
 * 未提供（全局视图）；超长或含 ASCII 控制字符视为非法。该值只用于
 * `agents.get(sessionId)`，不拼接任何路径或命令。
 */
function sessionIdParamOf(url: URL): string | undefined | null {
  const raw = url.searchParams.get('sessionId')
  if (raw === null || raw === '') return undefined
  if (raw.length > MAX_SESSION_ID_LENGTH) return null
  if (/[\u0000-\u001f\u007f]/.test(raw)) return null
  return raw
}
