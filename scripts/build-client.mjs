/**
 * Bundle the browser half into the module system's lazy-CJS factory format:
 *
 * - `src/client.tsx` → `lib/client.js`, wrapped as
 *   `window.__ModuleLoader__.load({ id, factory: (require) => { … } })`
 *   (the package entry; the manifest's `dsh.client` block points here).
 *
 * The Harness Web shell seeds a fixed module table and registers plugin
 * bundles with `window.__ModuleLoader__.load`; the factory receives a
 * synchronous `require` for shared platform modules (verified rc.5 seed set
 * in `@deepseek-ai/dsh-web-frontend`, `staticModules`). Bundling any of them
 * would ship a duplicate React instance and break the host — the build below
 * asserts they stay external AND that no React runtime leaked into the
 * output. No @deepseek-ai package is required to build: every external is
 * supplied by the shell at runtime.
 */
import { build } from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/** Package identity; must equal the manifest name and the factory id. */
const PACKAGE_NAME = '@hanxu131/toolscontrol-dsh'
/** Source entry and build output. */
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const OUT_FILE = join(ROOT, 'lib', 'client.js')

/**
 * Modules the Harness Web shell seeds into the module table
 * (`staticModules` in `@deepseek-ai/dsh-web-frontend`, rc.5 extract).
 */
const PLATFORM_MODULES = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  'zod',
  '@tanstack/react-virtual',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
]

function envelope(code) {
  return (
    'window.__ModuleLoader__.load({\n' +
    '\tid: ' +
    JSON.stringify(PACKAGE_NAME) +
    ',\n' +
    '\tfactory: (require) => {\n' +
    '\t\tvar module = { exports: {} };\n' +
    '\t\tvar exports = module.exports;\n' +
    '\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });\n' +
    code +
    '\n\t\treturn module.exports;\n\t}\n});\n'
  )
}

const result = await build({
  entryPoints: [join(ROOT, 'src', 'client.tsx')],
  outfile: OUT_FILE,
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'browser',
  target: ['chrome110', 'safari16', 'firefox110'],
  jsx: 'automatic',
  external: PLATFORM_MODULES,
  logLevel: 'warning',
  sourcemap: false,
  legalComments: 'none',
  charset: 'utf8',
  define: { 'process.env.NODE_ENV': '"production"' },
})

const files = result.outputFiles ?? []
const file = files.find((candidate) => candidate.path.endsWith('client.js'))
if (file === undefined) throw new Error('build-client: esbuild produced no client.js output')

const code = envelope(file.text)
const marker = 'window.__ModuleLoader__.load('
if (!code.startsWith(marker)) throw new Error('build-client: output does not start with the module loader call')

// Contract assertions — the shipped envelope must…
const checks = [
  ['factory', 'declare a factory'],
  ['plugins.tab', 'reference the plugins.tab slot'],
  ['id: "mcp"', 'register the MCP tab id'],
  ['id: "skills"', 'register the Skills tab id'],
  ['toolscontrol', 'own the toolscontrol locale namespace'],
]
for (const [needle, why] of checks) {
  if (!code.includes(needle)) throw new Error(`build-client: output is missing "${needle}" (${why})`)
}
// …and must NOT bundle a second React: every react reference stays external.
if (code.includes('Minified React error') || /react-dom/.test(code.replace(/['"]react-dom\/client['"]/g, ''))) {
  throw new Error('build-client: react runtime leaked into the bundle')
}
if (!/require\(['"]react\/jsx-runtime['"]\)/.test(code)) {
  throw new Error('build-client: jsx runtime is not referenced as an external module')
}

await mkdir(dirname(OUT_FILE), { recursive: true })
await writeFile(OUT_FILE, code, 'utf8')
console.log(`build-client: wrote lib/client.js (${code.length} bytes, two plugins.tab ids: mcp + skills)`)
