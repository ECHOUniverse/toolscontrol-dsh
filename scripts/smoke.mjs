/**
 * Offline artifact smoke (no Desktop, no real network).
 *
 * Runs AFTER `pnpm build` and verifies the PUBLIC contract of the two built
 * artifacts:
 *
 * - `lib/index.js` (Host half): the named-export surface the loader/patch
 *   rely on (`apply`, `inject`, `name`, `createRuntime`, `registerRoutes`,
 *   protocol re-exports) — imported directly.
 * - `lib/client.js` (Client half): the ModuleLoader envelope — static
 *   assertions (envelope head, package id, BOTH `plugins.tab` ids, react
 *   strictly external, no bundled react runtime) PLUS a full offline
 *   execution: the factory runs against a mock module table and `apply` is
 *   driven against a mock client context with spy transports, asserting the
 *   snapshot is fetched ONLY on tab entry and the probe endpoint is NEVER
 *   called automatically (rc.5 capabilities off).
 *
 * Exit code non-zero on any failure; every check prints one line.
 */
import { readFileSync, existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const HOST = join(ROOT, 'lib', 'index.js')
const CLIENT = join(ROOT, 'lib', 'client.js')

let failures = 0
/** Check + report one line. */
function check(label, ok, detail = '') {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${ok || detail === '' ? '' : ` — ${detail}`}`)
  if (!ok) failures += 1
}

// ---------------------------------------------------------------------------
// Host half: import the built entry and assert the named-export surface
// ---------------------------------------------------------------------------

if (!existsSync(HOST)) {
  console.error('smoke: lib/index.js not found — run `pnpm build` first')
  process.exit(1)
}
const host = await import(pathToFileURL(HOST).href)
check('host: exports apply', typeof host.apply === 'function')
check('host: exports createRuntime', typeof host.createRuntime === 'function')
check('host: exports registerRoutes', typeof host.registerRoutes === 'function')
check('host: plugin name', host.name === 'toolscontrol', String(host.name))
check('host: PLUGIN_NAME matches manifest', typeof host.PLUGIN_NAME === 'string' && host.PLUGIN_NAME.includes('toolscontrol-dsh'))
check('host: inject is empty (late-bound effects)', Array.isArray(host.inject) && host.inject.length === 0)
check(
  'host: route table under /toolscontrol',
  host.ROUTE_BASE === '/toolscontrol' &&
    host.ROUTES?.health === '/toolscontrol/health' &&
    host.ROUTES?.overview === '/toolscontrol/overview' &&
    host.ROUTES?.probe === '/toolscontrol/mcp/probe',
)

// ---------------------------------------------------------------------------
// Client half: static envelope assertions
// ---------------------------------------------------------------------------

if (!existsSync(CLIENT)) {
  console.error('smoke: lib/client.js not found — run `pnpm build` first')
  process.exit(1)
}
const code = readFileSync(CLIENT, 'utf8')
check('client: ModuleLoader envelope head', code.startsWith('window.__ModuleLoader__.load({'))
check('client: factory signature', code.includes('factory: (require)'))
check('client: package id', code.includes('id: "@hanxu131/toolscontrol-dsh"'))
check('client: plugins.tab slot', code.includes('plugins.tab'))
check('client: MCP tab id', code.includes('id: "mcp"'))
check('client: Skills tab id', code.includes('id: "skills"'))
check('client: react is an external require', /require\(['"]react['"]\)/.test(code))
check('client: jsx-runtime is an external require', /require\(['"]react\/jsx-runtime['"]\)/.test(code))
check('client: no bundled react runtime', !code.includes('Minified React error'))
check('client: locale namespace present', code.includes('toolscontrol'))
check('client: workspace stores consumed', code.includes('sessions') && code.includes('workspaces'))

// ---------------------------------------------------------------------------
// Client half: offline execution — mock loader + mock client context
// ---------------------------------------------------------------------------

const registry = {
  react: {
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: () => {},
    useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
  },
  'react/jsx-runtime': { jsx: () => null, jsxs: () => null, Fragment: 'Fragment' },
}

let clientExports = null
globalThis.window = {
  __ModuleLoader__: {
    load(def) {
      if (def.id !== '@hanxu131/toolscontrol-dsh') throw new Error(`unexpected bundle id: ${def.id}`)
      const require = (specifier) => {
        if (!(specifier in registry)) throw new Error(`missing external: ${specifier}`)
        return registry[specifier]
      }
      clientExports = def.factory(require)
    },
  },
}
new Function(code)()
check('client: envelope executed, apply exported', typeof clientExports?.apply === 'function')
check(
  'client: inject declares slots/locale/remote/sessions/workspaces',
  JSON.stringify(clientExports?.inject) === JSON.stringify(['slots', 'locale', 'remote', 'sessions', 'workspaces']),
)
check('client: locale namespace export', clientExports?.NS === 'toolscontrol')

// Mock client context (rc.5 shape; NO mcpManager — it does not exist there).
function makeCtx() {
  const dictionaries = {}
  const registrations = []
  const handlers = {}
  const disposers = []
  const sessions = {
    snap: { ids: [], byId: {} },
    listeners: new Set(),
    getSnapshot() {
      return this.snap
    },
    subscribe(listener) {
      this.listeners.add(listener)
      return () => this.listeners.delete(listener)
    },
    set(next) {
      this.snap = next
      for (const listener of [...this.listeners]) listener()
    },
  }
  const workspaces = { snap: { items: [] }, listeners: new Set() }
  Object.assign(workspaces, {
    getSnapshot() {
      return this.snap
    },
    subscribe(listener) {
      this.listeners.add(listener)
      return () => this.listeners.delete(listener)
    },
  })
  const ctx = {
    locale: {
      register: (ns, dicts) => {
        dictionaries[ns] = dicts
        return () => {}
      },
      bind: () => (key) => dictionaries.toolscontrol?.en?.[key] ?? key,
      subscribe: () => () => {},
      getSnapshot: () => ({ active: 'en', revision: 0 }),
    },
    slots: {
      inject: (_slot, callback) => {
        const inner = callback()
        return () => inner?.()
      },
      register: (options, component) => {
        registrations.push({ options, component })
        return () => {}
      },
    },
    remote: {
      $on: (event, handler) => {
        ;(handlers[event] ??= []).push(handler)
        return () => {}
      },
      // mcpManager deliberately absent (rc.5 fact).
    },
    effect: (callback) => {
      const result = callback()
      const disposer = typeof result === 'function' ? result : undefined
      if (disposer !== undefined) disposers.push(disposer)
      return () => disposer?.()
    },
    get: (name) => (name === 'sessions' ? { list: sessions } : name === 'workspaces' ? { list: workspaces } : undefined),
  }
  return { ctx, registrations, handlers, disposers, sessions, workspaces }
}

const snapshot = {
  plugin: 'smoke',
  version: '0',
  generatedAt: 0,
  mcp: {
    mode: 'config',
    capabilities: { connectionStatus: false, toolCount: false, probe: false },
    servers: [{ name: 'siyuan', enabled: true, configured: true, status: 'unknown', source: 'unknown' }],
    warnings: [],
  },
  skills: { cwd: null, skills: [], warnings: ['runtime sources cannot be fully enumerated'] },
}

const fetchCalls = []
let probeCalls = 0
const fetchOverview = (args) => {
  fetchCalls.push(args.cwd ?? null)
  return Promise.resolve(snapshot)
}
const probe = () => {
  probeCalls += 1
  return Promise.resolve({ ok: true, toolNames: [] })
}

const { ctx, registrations, handlers, disposers, sessions } = makeCtx()
clientExports.apply(ctx, { fetchOverview, probe })

check('apply: registers BOTH plugins.tab entries', registrations.length === 2 && registrations[0]?.options?.id === 'mcp' && registrations[1]?.options?.id === 'skills')
check('apply: no fetch at mount time (fetch happens on tab entry)', fetchCalls.length === 0, `got ${fetchCalls.length}`)
check('apply: NO automatic probe', probeCalls === 0, `got ${probeCalls}`)
check('apply: plugin-manager/changed handler registered', (handlers['plugin-manager/changed'] ?? []).length === 1)

const tc = registrations[0].options.inject().tc
tc.ensure()
const state = tc.getSnapshot()
check('tab entry: fetch issued once', fetchCalls.length === 1, `got ${fetchCalls.length}`)
await new Promise((resolve) => setTimeout(resolve, 0))
await Promise.resolve()
check('tab entry: snapshot ready', tc.getSnapshot().status === 'ready', tc.getSnapshot().status)
check('tab entry: NO probe after snapshot (rc.5 capabilities off)', probeCalls === 0, `got ${probeCalls}`)

// The one explicit probe path must stay gated: capability off ⇒ no request.
tc.requestProbe('siyuan')
await new Promise((resolve) => setTimeout(resolve, 0))
await Promise.resolve()
check('explicit probe request with capability off: still no POST', probeCalls === 0, `got ${probeCalls}`)

// Re-entry refetches; dispose stops everything.
tc.ensure()
check('tab re-entry: refetches', fetchCalls.length === 2, `got ${fetchCalls.length}`)
for (const disposer of disposers.reverse()) disposer()
sessions.set({ ids: ['a'], byId: { a: { id: 'a', cwd: '/a', retainedBy: { mainView: 1 } } } })
await new Promise((resolve) => setTimeout(resolve, 0))
check('after dispose: store changes drive no fetch', fetchCalls.length === 2, `got ${fetchCalls.length}`)
check('never probed during the whole offline run', probeCalls === 0, `got ${probeCalls}`)

// ---------------------------------------------------------------------------
if (failures > 0) {
  console.error(`smoke: ${failures} check(s) failed`)
  process.exit(1)
}
console.log('smoke: all checks passed (offline; no Desktop, no network)')
