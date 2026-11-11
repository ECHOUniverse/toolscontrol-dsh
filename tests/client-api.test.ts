/**
 * Client 传输层回归：overview 查询参数与 probeKey 探测请求。
 *
 * - overview 请求必须同时携带 cwd 与 sessionId（会话 scope 的入口）。
 * - probe 请求体只含 `probeKey`，绝不携带显示名/配置/凭据。
 * - 响应必须通过结构检查；网络失败的原始错误（可能含 URL）不得透出。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchOverview, probeByKey } from '../src/client/api.ts'
import { ROUTES, type McpProbeResponse, type OverviewSnapshot } from '../src/shared/protocol.ts'

const SNAPSHOT: OverviewSnapshot = {
  plugin: 'test',
  version: '0',
  generatedAt: 0,
  mcp: {
    mode: 'config',
    capabilities: { connectionStatus: false, toolCount: false, probe: false },
    servers: [],
    warnings: [],
  },
  skills: { cwd: null, skills: [], warnings: [] },
}

const SUCCESS: McpProbeResponse = {
  ok: true,
  probeKey: 'preset:p1:siyuan',
  scope: 'preset',
  presetId: 'p1',
  entryId: 'siyuan',
  probedAt: 1_700_000_000_000,
  durationMs: 42,
  toolNames: ['paper_search', 'read_doc'],
  toolCount: 2,
}

const FAILURE: McpProbeResponse = {
  ok: false,
  probeKey: 'profile:zotero',
  stage: 'connect',
  code: 'connect',
  message: '连接 MCP 服务器失败',
  durationMs: 7,
}

afterEach(() => {
  vi.unstubAllGlobals()
})

function stubFetch(urls: string[], response: Response = jsonResponse(SUCCESS)): { bodies: string[] } {
  const bodies: string[] = []
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    urls.push(String(input))
    if (typeof init?.body === 'string') bodies.push(init.body)
    return response
  })
  return { bodies }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('fetchOverview 查询参数', () => {
  it('同时传递 cwd 与 sessionId', async () => {
    const urls: string[] = []
    stubFetch(urls, jsonResponse(SNAPSHOT))
    await fetchOverview({
      cwd: '/workspace/demo',
      sessionId: 'session-8c1c4345',
      signal: new AbortController().signal,
    })
    expect(urls).toEqual(['/toolscontrol/overview?cwd=%2Fworkspace%2Fdemo&sessionId=session-8c1c4345'])
  })

  it('仅有 sessionId 时也传递（主 Session 没有 cwd 的合法场景）', async () => {
    const urls: string[] = []
    stubFetch(urls, jsonResponse(SNAPSHOT))
    await fetchOverview({ sessionId: 'session-8c1c4345', signal: new AbortController().signal })
    expect(urls).toEqual(['/toolscontrol/overview?sessionId=session-8c1c4345'])
  })
})

describe('probeByKey 请求与响应', () => {
  it('POST 到 probe 路由，请求体只有 probeKey（无显示名/配置/凭据）', async () => {
    const urls: string[] = []
    const { bodies } = stubFetch(urls)
    const answer = await probeByKey({ probeKey: 'preset:p1:siyuan', signal: new AbortController().signal })
    expect(answer).toEqual(SUCCESS)
    expect(urls).toEqual([ROUTES.probe])
    expect(JSON.parse(bodies[0]!)).toEqual({ probeKey: 'preset:p1:siyuan' })
    expect(Object.keys(JSON.parse(bodies[0]!) as Record<string, unknown>)).toEqual(['probeKey'])
  })

  it('成功 0 工具也是合法响应（探测成功，不是空响应）', async () => {
    const urls: string[] = []
    stubFetch(urls, jsonResponse({ ...SUCCESS, toolNames: [], toolCount: 0 }))
    const answer = await probeByKey({ probeKey: 'preset:p1:siyuan', signal: new AbortController().signal })
    expect(answer.ok).toBe(true)
    if (answer.ok) expect(answer.toolCount).toBe(0)
  })

  it('失败响应保留 stage/code/message/durationMs', async () => {
    const urls: string[] = []
    stubFetch(urls, jsonResponse(FAILURE))
    const answer = await probeByKey({ probeKey: 'profile:zotero', signal: new AbortController().signal })
    expect(answer).toEqual(FAILURE)
  })

  it('结构不合法（成功缺 toolNames、失败缺 code、probeKey 非字符串）一律拒绝', async () => {
    const cases: unknown[] = [
      { ...SUCCESS, toolNames: undefined },
      { ...SUCCESS, toolCount: 'two' },
      { ...FAILURE, code: undefined },
      { ...FAILURE, durationMs: 'fast' },
      { ...SUCCESS, probeKey: '' },
      { ok: true },
    ]
    for (const body of cases) {
      vi.unstubAllGlobals()
      const urls: string[] = []
      stubFetch(urls, jsonResponse(body))
      await expect(probeByKey({ probeKey: 'profile:siyuan', signal: new AbortController().signal })).rejects.toThrow(
        'probe payload is malformed',
      )
    }
  })

  it('响应 probeKey 与请求不一致时拒绝（防止错误结果挂到别的条目）', async () => {
    const urls: string[] = []
    stubFetch(urls, jsonResponse({ ...SUCCESS, probeKey: 'profile:other' }))
    await expect(
      probeByKey({ probeKey: 'profile:siyuan', signal: new AbortController().signal }),
    ).rejects.toThrow('probe payload is malformed')
  })

  it('网络失败只抛固定的无 URL 文案，不泄露 fetch 原始错误', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('failed to reach http://127.0.0.1:9999/secret?token=abc')
    })
    const error = await probeByKey({ probeKey: 'profile:siyuan', signal: new AbortController().signal }).catch(
      (reason: unknown) => reason,
    )
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('probe request failed')
    expect((error as Error).message).not.toMatch(/https?:|token=/)
  })

  it('非 2xx 使用错误包络的 message（不含请求体/凭据）', async () => {
    const urls: string[] = []
    stubFetch(urls, jsonResponse({ error: { code: 'invalid_input', message: 'probeKey must be a non-empty string' } }, 400))
    await expect(probeByKey({ probeKey: '', signal: new AbortController().signal })).rejects.toThrow(
      'probeKey must be a non-empty string',
    )
  })
})
