# @hanxu131/toolscontrol-dsh

A standalone DSH Desktop plugin: adds two READ-ONLY tabs — **MCP** and **Skills** — to the right of “Discover” on the Plugins page, summarizing the current state, source labels and invocation policy of MCP entries and Skills. Read-only by design: no enable/disable, no config or file writes.

> 中文文档：[README.md](./README.md)

## Features

- **MCP tab**: name search; enabled-state filter (Enabled / Disabled / All, default shows enabled only); connection-status filter; manual refresh with last-refreshed time; inline detail (connection status, scope, source, configured flag). Entries are labeled with their DSH composition scope — **DSH profile root** or **Preset: <name>**. Same-name entries in different scopes are listed separately and never merged into one global entry.
- **Skills tab**: name/description/when-to-use search; source filter (All sources plus each source); invocation filter (All invocation modes / user-invocable / model-invocable / not invocable); manual refresh; inline detail (description, when to use, source, path, invocation policy). Same-name **overridden** versions appear ONLY inside the effective entry's detail — never as independent main rows. Sources follow the host language (for example “DSH built-in”, “Plugin runtime”, “User .dsh directory”, “Project .agents directory”); unknown or future sources fall back to the raw id.
- **Workspace & session tracking**: follows the workspace currently selected in the Desktop sidebar (the main session's `retainedBy.mainView`); switching workspaces re-fetches with the new `cwd`. Skills are also read through that main session's live Agent **preset scope** (the request carries `sessionId`), and switching sessions under the same cwd re-fetches too. With no main session the tab clearly states “No workspace selected — showing global skills”, shows the global registry only, and never guesses a default directory. With a main session but an unknown project directory it says so and reports the session preset scope — never as global or session results by guesswork.
- **Bilingual**: zh/en UI strings registered with the host locale and following the host language; entry names are never translated; lists sort stably via `Intl.Collator` bound to the active language.
- **Keyboard accessible**: inline expansion uses real buttons (`aria-expanded` / `aria-controls`) with host-token focus rings.

## rc.5 capability boundary (Desktop 0.2.1-rc.5)

MCP data comes from the pluginInventory config layer (`mode: "config"`), merging BOTH composition surfaces of the official `list()`:

- **Profile root** `entries`: Loader entries of the current Desktop profile's root composition (scope label “DSH profile root”);
- **Preset compositions** `agentPresets[].rows`: rows declared inside each agent preset (scope label “Preset: <name>”). In current DSH the session preset layer is where model-facing plugins actually run, so an MCP server configured only inside a preset must still show up.

Deduplication: within one `(scope, preset id, entry name)` only the first row is kept and the page warnings state how many duplicates were ignored; **the same name in different scopes is NOT a duplicate** and both entries are listed. A preset row without a Loader entry id (the official type allows `entryId: null`) falls back to the module name. A row whose `disabled` is an expression (official `'conditional'`) cannot be resolved statically, so the UI labels it “Conditionally enabled” instead of pretending it is statically enabled/disabled. An MCP row's `enabled` accepts only a boolean or `'conditional'`; a missing or other-typed value never defaults to enabled — that row is skipped with a warning. Malformed data (`agentPresets` not an array, preset without id, `rows` not an array, unparsable rows) is skipped item by item with a warning — the snapshot never fails as a whole.

When the entire DSH composition (profile root plus every preset) was read COMPLETELY and declares no MCP server, the empty state explicitly says **“No MCP server is configured in the current DSH profile or its presets (DSH-internal sources only; external CLI configs are not read)”**. That is a conclusion about a complete readable snapshot, not a claim about any external CLI's configuration. Any unavailable source or unparsable surface/row sets `canAssertEmpty=false`, so the UI falls back to the neutral empty state with the warnings and never claims “not configured”.

| Capability | rc.5 | Behavior |
| --- | --- | --- |
| Connection-status observation | unavailable | every entry shows “**Unknown**”; process/loader phases are never presented as connection status |
| Tool counts | unavailable | hidden |
| Tool probing (probe) | unavailable | no “Load tool list” button; a capability-degradation note is shown on the page |

When the official managed `mcpManager` becomes available (`mode: "managed"`): real connection statuses and tool counts appear; the “Load tool list” button lives inside the row detail and a probe POST (by name only, never touching configuration) fires **only on explicit user click** — never automatically.

Skills limitation: overridden versions are not guaranteed complete — **runtime, preset and custom-directory competitors cannot be fully enumerated**. The enumeration-limit notes returned by the host always render in the Notes section; a single-source failure never blanks the page (partial data + notes), and a true request failure with no previous data shows the error empty state, while existing data is retained with a stale notice.

## Security model

- Host routes are same-origin under `/toolscontrol`: only `health` is public (plugin identity); `overview` / `mcp/probe` pass the official `connection.requestRejection` trust fence (authentication + Host/Origin/`sec-fetch-site`).
- Wire payloads **never carry** MCP env / headers / tokens / commands / URLs; the client uses plain same-origin `fetch` and reads no configuration files. MCP data comes only from DSH's own composition (pluginInventory): **`~/.cursor`, `~/.kimi-code`, `~/.config/mcp` and other external CLI configs are never read**, and no external MCP adapters are added.
- No sensitive configuration is rendered; there are no Switch-style mutation controls.

## Install & uninstall

### Generic CLI (non-desktop profiles)

```bash
# Local development (<profile> = your own DSH profile name; the path must be absolute)
dsh plugin --profile <profile> add link:/absolute/path/to/toolscontrol-dsh

# From npm
dsh plugin --profile <profile> add @hanxu131/toolscontrol-dsh

# Uninstall
dsh plugin --profile <profile> remove @hanxu131/toolscontrol-dsh
```

> **`desktop` is a reserved profile owned exclusively by the Desktop (Electron) app**: the generic `dsh` CLI rejects it outright (rc.5 evidence, verbatim: `error: profile "desktop" is managed exclusively by the Electron application`). Never substitute `desktop` for `<profile>` above; the desktop profile is managed only by the Desktop app itself (its bundled carrier CLI also requires fully quitting Desktop first).

### Install inside the Desktop app (documented officially; NOT yet verified on a real machine for this plugin)

Per Desktop rc.5's bundled official plugin-management docs, the Plugins-page **Add plugin / Install third-party plugin** dialog accepts a **package name, Git URL, tarball, or local absolute path** (spec forms accepted by `pnpm add`), and only packages declaring a bundle patch — this plugin's `cordis.patch.yml` satisfies that requirement. A local tarball/directory should therefore be installable through that dialog, but **this GUI flow has not been manually verified for this plugin on a real Desktop**; see [docs/DESKTOP-ACCEPTANCE.md](./docs/DESKTOP-ACCEPTANCE.md) for the item-by-item checklist.

Installing mounts both halves at once: the Host half (via `cordis.patch.yml` into the profile composition) and the Client half (via the `dsh.client` manifest, web platform, loaded immediately). Both Plugins-page tabs disappear with the package.

## Build & test

```bash
pnpm install
pnpm build       # tsc → Host lib/ + esbuild → lib/client.js envelope
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest: host behavior + client controller/view-model + artifact contract
pnpm smoke       # offline artifact smoke: envelope execution, both tab ids, react external, no auto probe
pnpm verify      # clean && build → typecheck → test → smoke
pnpm pack        # publish-package preview
```

Requires Node `^22.19.0 || >=24` and Desktop `>=0.2.1-rc.1 <0.3.0-0`. Tests and smoke are fully offline (transport is injected; no Desktop access, no network).

## Package layout

- `lib/index.js` — Host half: late-bound mounting of pluginInventory / skills / mcpManager / webServer+connection, registering the read-only `/toolscontrol` routes.
- `lib/client.js` — Client half: a `window.__ModuleLoader__.load({id, factory})` envelope; react / react-dom / cordis and friends stay external (host module table) — no second React is bundled.
- `src/client/controller.ts` — the public controller for search/filter/detail/workspace tracking (the test seam; no React component interaction tests).

## Manual desktop acceptance

GUI behavior has **not** been automatically verified. For the manual checklist on a real Desktop 0.2.1-rc.5 see [docs/DESKTOP-ACCEPTANCE.md](./docs/DESKTOP-ACCEPTANCE.md).
