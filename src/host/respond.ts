/**
 * Host 路由共享的 HTTP 管道：官方信任门、统一 JSON 响应、错误包络与
 * 有界请求体读取（对齐官方自定义路由契约的处理器形态）。
 *
 * @module @hanxu131/toolscontrol-dsh/host/respond
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ErrorCode, ErrorResponse } from '../shared/protocol.ts'
import type { ConnectionFace } from './services.ts'

/** Structurally minimal request the handlers need (node:http IncomingMessage). */
export type RouteRequest = IncomingMessage

/** Structurally minimal response (node:http ServerResponse). */
export type RouteResponse = ServerResponse

/** JSON response with the no-store policy (overview facts are live). */
export function sendJson(res: RouteResponse, status: number, payload: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(payload))
}

/** `405` with the route's supported methods. */
export function sendMethodNotAllowed(res: RouteResponse, allow: string): void {
  res.statusCode = 405
  res.setHeader('allow', allow)
  res.end()
}

/** Uniform error envelope. */
export function sendError(res: RouteResponse, status: number, code: ErrorCode, message: string, details?: Record<string, unknown>): void {
  const error: ErrorResponse['error'] = { code, message }
  if (details !== undefined) error.details = details
  const body: ErrorResponse = { error }
  sendJson(res, status, body)
}

/**
 * Map any thrown value onto the envelope. The wire message is a fixed,
 * locale-neutral string: internal error text (which may contain paths,
 * credentials or stack fragments) NEVER crosses the wire.
 */
export function sendUnknownError(res: RouteResponse, error: unknown): void {
  void error
  sendError(res, 500, 'internal', 'Internal server error')
}

/**
 * Apply the official trust fence. Resolves `true` when the request was
 * rejected (and answered); `false` means the request is trusted and
 * authenticated and the handler may proceed.
 */
export function rejectUntrusted(req: RouteRequest, res: RouteResponse, connection: ConnectionFace | undefined): boolean {
  if (connection === undefined) {
    // Defensive: handlers must not even be reachable without the fence. A
    // missing connection service means no protected surface at all.
    sendError(res, 503, 'service_unavailable', 'The DSH connection service is not available; this route is disabled.')
    return true
  }
  const rejection = connection.requestRejection(req)
  if (rejection === undefined) return false
  res.statusCode = rejection
  res.end()
  return true
}

/** Media type of a `Content-Type` header, lowercased, parameters stripped. */
export function mediaTypeOf(req: RouteRequest): string {
  return String(req.headers['content-type'] ?? '')
    .split(';', 1)[0]!
    .trim()
    .toLowerCase()
}

/**
 * Collect a bounded request body; `null` once the ceiling is crossed (the
 * stream is drained so the socket can be reused cleanly).
 */
export async function readBoundedBody(req: RouteRequest, maxBytes: number): Promise<Buffer | null> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).byteLength
    if (size > maxBytes) {
      req.resume()
      return null
    }
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks, size)
}

/** Parse a JSON object body after the media-type gate; responds and returns null on failure. */
export async function readJsonObject(req: RouteRequest, res: RouteResponse, maxBytes: number): Promise<Record<string, unknown> | null> {
  if (mediaTypeOf(req) !== 'application/json') {
    sendError(res, 415, 'unsupported_media_type', 'content-type must be application/json')
    return null
  }
  let text: string
  try {
    const bytes = await readBoundedBody(req, maxBytes)
    if (bytes === null) {
      sendError(res, 413, 'payload_too_large', `request body exceeds ${maxBytes} bytes`)
      return null
    }
    text = bytes.toString('utf8')
  } catch {
    sendError(res, 400, 'invalid_input', 'request body unreadable')
    return null
  }
  let parsed: unknown
  try {
    parsed = text.length === 0 ? undefined : JSON.parse(text)
  } catch {
    sendError(res, 400, 'invalid_input', 'request body must be valid JSON')
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    sendError(res, 400, 'invalid_input', 'request body must be a JSON object')
    return null
  }
  return parsed as Record<string, unknown>
}
