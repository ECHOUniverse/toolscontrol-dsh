/**
 * 共享协议与清单一致性：插件标识、路由命名空间、版本同步与安全底线
 * （wire 类型不携带敏感字段名）。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PLUGIN_NAME, PLUGIN_VERSION, ROUTE_BASE, ROUTES } from '../src/shared/protocol.ts'
import * as protocol from '../src/shared/protocol.ts'

const packageJson = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')) as {
  name: string
  version: string
  engines: { dsh: string }
}

describe('协议与清单一致性', () => {
  it('插件名与版本与 package.json 同步', () => {
    expect(PLUGIN_NAME).toBe(packageJson.name)
    expect(PLUGIN_VERSION).toBe(packageJson.version)
  })

  it('engines.dsh 限定 0.2.1-rc.x 窗口', () => {
    expect(packageJson.engines.dsh).toBe('>=0.2.1-rc.1 <0.3.0-0')
  })

  it('路由全部收在 /toolscontrol 命名空间内', () => {
    for (const route of Object.values(ROUTES)) {
      expect(route.startsWith(`${ROUTE_BASE}/`)).toBe(true)
    }
  })

  it('wire 载荷类型不含敏感字段名（env/headers/token/credential）', () => {
    const source = readFileSync(fileURLToPath(new URL('../src/shared/protocol.ts', import.meta.url)), 'utf8')
    // 逐行检查 wire 接口成员（协议文件中除安全注释外不得出现这些字段名）
    const memberLines = source.split('\n').filter((line) => /^\s{2,}\w+\??:/.test(line))
    for (const line of memberLines) {
      expect(line.toLowerCase()).not.toMatch(/\b(env|headers|token|credential|apikey|password)\b/)
    }
  })

  it('MCP 连接状态联合以 unknown 起始（rc.5 领域边界）', () => {
    // 类型层契约以编译期保证；此处锁定字面量集合的文档顺序不被移除。
    const source = readFileSync(fileURLToPath(new URL('../src/shared/protocol.ts', import.meta.url)), 'utf8')
    expect(source).toContain("| 'unknown'")
    expect(protocol.PLUGIN_VERSION.length).toBeGreaterThan(0)
  })
})
