/**
 * `@hanxu131/toolscontrol-dsh` — DSH 只读总览 MCP 与 Skills 的独立插件（宿主半）。
 *
 * 装配契约（apply）：
 *
 * 1. 不在 apply 期读任何组合服务：每个能力都经官方晚绑定 effect
 *    （`ctx.inject(deps, cb)`）挂载——组合服务在兄弟 fiber，`inject: []`
 *    插件在 apply 期直读会抛错（真实 Desktop 0.2.1-rc.5 实测结论，
 *    同级项目同款模式）。每个 effect 返回自己的 disposer，服务 cycle 时
 *    精确卸载重挂，不重复注册；服务永不出现的 profile 上回调不执行、
 *    插件保持已激活（功能降级，不拖垮 profile）。
 * 2. `['pluginInventory']` → MCP 配置层条目与可靠启用状态（rc.5 降级路径；
 *    连接状态恒 unknown，绝不读 fiber phase）。
 * 3. `['skills']` → 生效 Skill 枚举（官方注册表；赢家始终为主）。
 * 4. `['agents']` + `['agentPresets']` → 把请求的 sessionId 映射到 live
 *    Agent，并按该会话 preset 的 scope 读取 Skills（官方
 *    `sessionSkillCatalog` 同源链路；无 live 会话时回退全局 + warning）。
 * 5. `['mcpManager']` → 未来环境可选挂载：官方 MCP 管理服务存在时提供
 *    真实列表/状态与显式 probe。该服务在 rc.5 不存在——effect 不执行，
 *    结构类型在 host/services.ts 本地声明，不静态依赖任何未发布包。
 * 6. `['webServer', 'connection']` → `/toolscontrol` 只读路由表
 *    （health 公开；overview/probe 经官方信任门）。
 *
 * 不做任何写操作：不改 MCP 配置、不写 Skill 文件；快照不携带 env/
 * headers/token 等敏感值。
 *
 * Named exports are required so the Cordis loader retains `inject`.
 *
 * @module @hanxu131/toolscontrol-dsh
 */
import type { Context } from '@deepseek-ai/cordis'
import { PLUGIN_NAME, PLUGIN_VERSION, ROUTE_BASE, ROUTES, type HealthResponse, type OverviewSnapshot } from './shared/protocol.ts'
import { McpCatalog } from './host/mcp.ts'
import { SkillCatalog } from './host/skills.ts'
import { OverviewService } from './host/inventory.ts'
import { registerRoutes } from './host/routes.ts'
import { serviceOf, type AgentPresetsFace, type AgentsFace, type ConnectionFace, type HostServices, type McpManagerFace, type PluginInventoryFace, type SkillsRegistryFace, type WebServerFace } from './host/services.ts'

/** Bundle id inside a profile composition. */
export const name = 'toolscontrol'

/**
 * No required host services: every composition service is consumed through a
 * per-capability `ctx.inject(deps, callback)` effect, so the bundle also
 * activates — degraded but healthy — on profiles that lack any of them.
 */
export const inject = [] as const

/** 可选的根目录覆盖（测试/诊断接缝；生产无需配置）。 */
export interface Config {
  skillRoots?: {
    dshHome?: string
    agentsHome?: string
  }
}

/**
 * Assemble the host half against EXPLICIT services: build both catalogs and
 * the overview facade, register the route table when a webServer is present,
 * and return the combined disposer. This is the eager seam for tests and
 * diagnostics — `apply` does NOT use it with a context lookup, because
 * sibling composition services are not readable from an `inject: []` plugin
 * fiber.
 */
export function createRuntime(config: Config = {}, services: HostServices = {}): {
  overview: OverviewService
  catalogs: { mcp: McpCatalog; skills: SkillCatalog }
  dispose: () => void
} {
  const mcp = new McpCatalog({
    ...(services.pluginInventory !== undefined ? { inventory: services.pluginInventory } : {}),
    ...(services.mcpManager !== undefined ? { manager: services.mcpManager } : {}),
  })
  const skills = new SkillCatalog({
    ...(services.skills !== undefined ? { registry: services.skills } : {}),
    ...(services.agents !== undefined ? { agents: services.agents } : {}),
    ...(services.agentPresets !== undefined ? { presets: services.agentPresets } : {}),
    ...(config.skillRoots !== undefined ? { roots: config.skillRoots } : {}),
  })
  const overview = new OverviewService(mcp, skills)
  const cleanups: (() => void)[] = []
  if (services.webServer !== undefined) {
    cleanups.push(registerRoutes(services.webServer, {
      overview,
      ...(services.connection !== undefined ? { connection: services.connection } : {}),
    }))
  }
  return {
    overview,
    catalogs: { mcp, skills },
    dispose: () => {
      for (const cleanup of cleanups.reverse()) cleanup()
    },
  }
}

/**
 * Mount the host half. No composition service is read at apply time: each
 * capability mounts through the official `ctx.inject(deps, callback)` effect,
 * and every callback RETURNS its disposer so a service cycle tears down
 * exactly that effect's registration before re-running.
 *
 * @param ctx - host plugin context.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const mcp = new McpCatalog()
  const skills = new SkillCatalog(config.skillRoots !== undefined ? { roots: config.skillRoots } : {})
  const overview = new OverviewService(mcp, skills)

  // MCP 配置层（rc.5 可用来源；连接状态恒 unknown）。
  ctx.inject(['pluginInventory'], (svcCtx) => {
    mcp.attachServices({ inventory: serviceOf<PluginInventoryFace>(svcCtx, 'pluginInventory') })
    return () => mcp.detachServices(['inventory'])
  })

  // 官方 Skills 注册表（生效项；赢家始终为主）。
  ctx.inject(['skills'], (svcCtx) => {
    skills.attachServices({ registry: serviceOf<SkillsRegistryFace>(svcCtx, 'skills') })
    return () => skills.detachServices(['registry'])
  })

  // 官方 Agent 注册表：把请求的 sessionId 映射到 live Agent（也是会话 scope）。
  ctx.inject(['agents'], (svcCtx) => {
    skills.attachServices({ agents: serviceOf<AgentsFace>(svcCtx, 'agents') })
    return () => skills.detachServices(['agents'])
  })

  // 官方 preset 注册表：解析会话 preset 内自带的 skills 服务（官方同源回退顺序）。
  ctx.inject(['agentPresets'], (svcCtx) => {
    skills.attachServices({ presets: serviceOf<AgentPresetsFace>(svcCtx, 'agentPresets') })
    return () => skills.detachServices(['presets'])
  })

  // 未来环境可选：官方 mcpManager（真实状态 + 显式 probe）；rc.5 无此服务。
  ctx.inject(['mcpManager'], (svcCtx) => {
    mcp.attachServices({ manager: serviceOf<McpManagerFace>(svcCtx, 'mcpManager') })
    return () => mcp.detachServices(['manager'])
  })

  // 只读路由载体：与官方 host 插件相同的必需对（webServer + connection）。
  ctx.inject(['webServer', 'connection'], (svcCtx) =>
    registerRoutes(serviceOf<WebServerFace>(svcCtx, 'webServer'), {
      overview,
      connection: serviceOf<ConnectionFace>(svcCtx, 'connection'),
    }))
}

// Re-exported for reviewers and the future client half.
export { ROUTE_BASE, ROUTES, PLUGIN_NAME, PLUGIN_VERSION, registerRoutes, type HealthResponse, type OverviewSnapshot }
