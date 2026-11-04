/**
 * 产物公共契约测试（离线）：package exports / dsh.client 清单 / cordis
 * patch / Host named exports。
 *
 * 这里锁定“包外围”的发布契约（文件与模块表面）；构建产物内容（envelope、
 * 两个 tab id、React external、不自动 probe）由 `scripts/smoke.mjs` 在
 * build 之后离线执行验证。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const packageJson = JSON.parse(readFileSync(`${root}/package.json`, 'utf8')) as {
  name: string
  version: string
  main: string
  exports: Record<string, string>
  files: string[]
  engines: { dsh: string }
  scripts: Record<string, string>
  dsh: {
    bundle?: { patch?: string }
    client?: { platform?: string; immediately?: boolean; inject?: string[] }
  }
}

describe('package.json 发布契约', () => {
  it('exports 同时暴露 Host 入口与 Client envelope', () => {
    expect(packageJson.exports['.']).toBe('./lib/index.js')
    expect(packageJson.exports['./client']).toBe('./lib/client.js')
    expect(packageJson.exports['./cordis.patch.yml']).toBe('./cordis.patch.yml')
    expect(packageJson.exports['./package.json']).toBe('./package.json')
    expect(packageJson.main).toBe('lib/index.js')
  })

  it('dsh.bundle.patch 指向 cordis.patch.yml，dsh.client 为 web 平台立即加载', () => {
    expect(packageJson.dsh.bundle?.patch).toBe('./cordis.patch.yml')
    expect(packageJson.dsh.client?.platform).toBe('web')
    expect(packageJson.dsh.client?.immediately).toBe(true)
  })

  it('dsh.client.inject 覆盖 remote/locale/sessions/workspaces/plugins 页所需包', () => {
    const inject = packageJson.dsh.client?.inject ?? []
    expect(inject).toContain('@deepseek-ai/dsh-api-remotes')
    expect(inject).toContain('@deepseek-ai/dsh-client-locale')
    expect(inject).toContain('@deepseek-ai/dsh-api-session-controller')
    expect(inject).toContain('@deepseek-ai/dsh-api-workspace-controller')
    expect(inject).toContain('@deepseek-ai/dsh-client-ui-plugin-manager')
  })

  it('files 携带文档，不含源码与测试目录', () => {
    expect(packageJson.files).toContain('lib')
    expect(packageJson.files).toContain('cordis.patch.yml')
    expect(packageJson.files).toContain('README.md')
    expect(packageJson.files).toContain('README.en.md')
    expect(packageJson.files).toContain('docs')
    expect(packageJson.files).not.toContain('src')
    expect(packageJson.files).not.toContain('tests')
    expect(packageJson.files).not.toContain('scripts')
  })

  it('verify 管线为 clean/build → typecheck → test → smoke，smoke 离线', () => {
    expect(packageJson.scripts.smoke).toBe('node scripts/smoke.mjs')
    const verify = packageJson.scripts.verify ?? ''
    for (const step of ['clean', 'build', 'typecheck', 'test', 'smoke']) {
      expect(verify).toContain(step)
    }
    const smokeIndex = verify.indexOf('smoke')
    expect(smokeIndex).toBeGreaterThan(verify.indexOf('test'))
  })
})

describe('cordis.patch.yml bundle patch 契约', () => {
  it('插入 toolscontrol 条目并指向本包名', () => {
    const patch = readFileSync(`${root}/cordis.patch.yml`, 'utf8')
    expect(patch).toContain('id: toolscontrol')
    expect(patch).toContain(`'${packageJson.name}'`)
  })
})

describe('Host named exports 契约', () => {
  it('入口暴露 apply/inject/name/createRuntime 与协议再导出', async () => {
    const entry = (await import('../src/index.ts')) as Record<string, unknown>
    expect(typeof entry.apply).toBe('function')
    expect(typeof entry.createRuntime).toBe('function')
    expect(typeof entry.registerRoutes).toBe('function')
    expect(entry.name).toBe('toolscontrol')
    expect(entry.PLUGIN_NAME).toBe(packageJson.name)
    expect(entry.PLUGIN_VERSION).toBe(packageJson.version)
    expect(entry.ROUTE_BASE).toBe('/toolscontrol')
    expect(entry.ROUTES).toEqual({
      health: '/toolscontrol/health',
      overview: '/toolscontrol/overview',
      probe: '/toolscontrol/mcp/probe',
    })
    // Host 半的 cordis 服务依赖声明为空（全部经晚绑定 effect 挂载）
    expect(Array.from(entry.inject as readonly string[])).toEqual([])
  })
})
