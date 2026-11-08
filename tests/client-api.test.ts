/**
 * Client 传输层回归：overview 请求必须同时携带 cwd 与 sessionId。
 *
 * 只修 Host 不够：会话 scope 的入口是 `sessionId`。这里用假 `fetch`
 * 驱动真实 `fetchOverview`，锁住 URL 查询参数（不测 Host 行为）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchOverview } from '../src/client/api.ts'
import type { OverviewSnapshot } from '../src/shared/protocol.ts'

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

afterEach(() => {
  vi.unstubAllGlobals()
})

function stubFetch(urls: string[]): void {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    urls.push(String(input))
    return new Response(JSON.stringify(SNAPSHOT), { status: 200, headers: { 'content-type': 'application/json' } })
  })
}

describe('fetchOverview 查询参数', () => {
  it('同时传递 cwd 与 sessionId', async () => {
    const urls: string[] = []
    stubFetch(urls)
    await fetchOverview({
      cwd: '/workspace/demo',
      sessionId: 'session-8c1c4345',
      signal: new AbortController().signal,
    })
    expect(urls).toEqual(['/toolscontrol/overview?cwd=%2Fworkspace%2Fdemo&sessionId=session-8c1c4345'])
  })

  it('仅有 sessionId 时也传递（主 Session 没有 cwd 的合法场景）', async () => {
    const urls: string[] = []
    stubFetch(urls)
    await fetchOverview({ sessionId: 'session-8c1c4345', signal: new AbortController().signal })
    expect(urls).toEqual(['/toolscontrol/overview?sessionId=session-8c1c4345'])
  })
})
