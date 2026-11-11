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
 * Probe requests carry exactly `{ probeKey }` — never a display name, config
 * or credential material. The response is checked field-by-field so a
 * malformed/legacy payload is rejected instead of being rendered.
 *
 * Network failures are reduced to a fixed, URL-free message: a raw `fetch`
 * error can embed the request URL, so it must never reach the UI.
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

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * Structural sanity check of one probe response.
 *
 * Success must carry `probeKey`, `probedAt`, `durationMs`, `toolNames`
 * (strings) and `toolCount`; failure must carry `probeKey`, `stage`, `code`,
 * `message` and `durationMs`. Anything else is malformed and rejected with a
 * fixed message (the payload may come from an older/mismatched Host).
 */
function assertProbe(data: unknown): McpProbeResponse {
  if (data === null || typeof data !== 'object') throw new Error('probe payload is malformed')
  const candidate = data as Record<string, unknown>
  if (typeof candidate.probeKey !== 'string' || candidate.probeKey === '') {
    throw new Error('probe payload is malformed')
  }
  if (candidate.ok === true) {
    const names = candidate.toolNames
    if (!Array.isArray(names) || !names.every((name) => typeof name === 'string')) {
      throw new Error('probe payload is malformed')
    }
    if (
      !isFiniteNumber(candidate.probedAt) ||
      !isFiniteNumber(candidate.durationMs) ||
      !isFiniteNumber(candidate.toolCount)
    ) {
      throw new Error('probe payload is malformed')
    }
    return data as McpProbeResponse
  }
  if (candidate.ok !== false) throw new Error('probe payload is malformed')
  if (
    typeof candidate.stage !== 'string' ||
    typeof candidate.code !== 'string' ||
    typeof candidate.message !== 'string' ||
    !isFiniteNumber(candidate.durationMs)
  ) {
    throw new Error('probe payload is malformed')
  }
  return data as McpProbeResponse
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

/**
 * Explicit `POST /toolscontrol/mcp/probe` for ONE entry, keyed by the
 * Host-issued stable `probeKey` (user-triggered only; never automatic).
 */
export async function probeByKey(args: { probeKey: string; signal: AbortSignal }): Promise<McpProbeResponse> {
  let response: Response
  try {
    response = await fetch(ROUTES.probe, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ probeKey: args.probeKey }),
      signal: args.signal,
    })
  } catch {
    // Fixed, URL-free message: the raw fetch error may contain the endpoint
    // (or other request details) and must never be surfaced.
    throw new Error('probe request failed')
  }
  if (!response.ok) throw new Error(await errorMessageOf(response))
  const answer = assertProbe(await response.json())
  // The Host must echo the key that was asked for; a mismatched payload is
  // never published under the requested key.
  if (answer.probeKey !== args.probeKey) throw new Error('probe payload is malformed')
  return answer
}
