/**
 * Browser half of `@hanxu131/toolscontrol-dsh`.
 *
 * Loaded by the Harness Web shell as
 * `window.__ModuleLoader__.load({ id: '@hanxu131/toolscontrol-dsh', factory })`
 * (built by `scripts/build-client.mjs` from this entry; every platform module
 * — react, cordis, the client UI kits — is an external supplied by the
 * shell's module table, so no second React is ever bundled).
 *
 * Contributes two READ-ONLY tabs to the Plugins page (`plugins.tab`):
 * `mcp` (order 100) and `skills` (order 110), right after the page's own
 * tabs. All UI text registers zh/en under the `toolscontrol` locale
 * namespace. See `client/ui.tsx` for the registration contract and
 * `client/controller.ts` for the testable behavior seam.
 *
 * @module @hanxu131/toolscontrol-dsh/client
 */
export { apply, inject, type ClientContext } from './client/ui.tsx'
export { NS } from './client/i18n.ts'
