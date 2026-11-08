/**
 * Same-origin transport of the client half.
 *
 * The Host routes are same-origin (`/toolscontrol/…`) and the trust fence is
 * the Host's job (`connection.requestRejection`): the client uses plain
 * `fetch` with an `AbortSignal` — no credentials, no config-file reads, no
 * absolute URLs. Error envelopes (`{error:{code,message}}`) surface their
 * human-readable message; payloads are structurally sanity-checked before
 * being trusted.
 *
 * @module @hanxu131/toolscontrol-dsh/client/api
 */

import { ROUTES, type McpProbeResponse, type OverviewSnapshot } from '../shared/protocol.ts'

/** Human-readable message of a non-2xx response (never credential material). */
async function errorMessageOf(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json()
    const message = (body as { error?: { message?: unknown } } | null)?.error?.message
    return typeof message === 'string' && message !== '' ? message : `HTTP ${response.status}`
  } catch {
    return `HTTP ${response.status}`
  }
}

/** Structural sanity check: an overview payload must carry both sections. */
function assertOverview(data: unknown): OverviewSnapshot {
  if (data === null || typeof data !== 'object') {
    throw new Error('overview payload is not an object')
  }
  const candidate = data as { plugin?: unknown; mcp?: unknown; skills?: unknown }
  if (typeof candidate.plugin !== 'string' || candidate.mcp === undefined || candidate.skills === undefined) {
    throw new Error('overview payload is missing the plugin/mcp/skills sections')
  }
  return data as OverviewSnapshot
}

/**
 * `GET /toolscontrol/overview?cwd=…&sessionId=…` (both omitted for the
 * global view; sessionId selects the session's preset skill scope).
 */
export async function fetchOverview(args: { cwd?: string; sessionId?: string; signal: AbortSignal }): Promise<OverviewSnapshot> {
  const params: string[] = []
  if (typeof args.cwd === 'string' && args.cwd !== '') params.push(`cwd=${encodeURIComponent(args.cwd)}`)
  if (typeof args.sessionId === 'string' && args.sessionId !== '') {
    params.push(`sessionId=${encodeURIComponent(args.sessionId)}`)
  }
  const query = params.length > 0 ? `?${params.join('&')}` : ''
  const response = await fetch(`${ROUTES.overview}${query}`, {
    signal: args.signal,
    headers: { accept: 'application/json' },
  })
  if (!response.ok) throw new Error(await errorMessageOf(response))
  return assertOverview(await response.json())
}

/** Explicit `POST /toolscontrol/mcp/probe` for ONE server (user-triggered only). */
export async function probeServer(args: { server: string; signal: AbortSignal }): Promise<McpProbeResponse> {
  const response = await fetch(ROUTES.probe, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ server: args.server }),
    signal: args.signal,
  })
  if (!response.ok) throw new Error(await errorMessageOf(response))
  const data: unknown = await response.json()
  if (data === null || typeof data !== 'object' || !('ok' in data)) {
    throw new Error('probe payload is malformed')
  }
  return data as McpProbeResponse
}
