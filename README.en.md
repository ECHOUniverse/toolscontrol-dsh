<div align="center">

# toolscontrol-dsh

**A read-only MCP and Skills overview for the DSH Desktop Plugins page**

`@hanxu131/toolscontrol-dsh` · v0.1.0

[![version](https://img.shields.io/github/package-json/v/ECHOUniverse/toolscontrol-dsh?label=version)](https://github.com/ECHOUniverse/toolscontrol-dsh)
[![node](https://img.shields.io/badge/node-%5E22.19.0%20%7C%7C%20%3E%3D24-339933.svg)](https://nodejs.org/)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](https://www.apache.org/licenses/LICENSE-2.0)
[![DSH Desktop](https://img.shields.io/badge/DSH%20Desktop-%3E%3D0.2.1--rc.1%20%3C0.3.0--0-blueviolet.svg)](https://github.com/ECHOUniverse/toolscontrol-dsh)

[中文](./README.md) · [Desktop acceptance checklist](./docs/DESKTOP-ACCEPTANCE.md)

</div>

## What it is

`toolscontrol-dsh` is a standalone read-only plugin for DSH Desktop. Once installed, it adds two tabs — **MCP** and **Skills** — to the right of **Discover** on the Plugins page, bringing the current Desktop's MCP entries and Skills into one place.

It answers three questions:

- Which MCP servers are configured in the current DSH profile root and in each agent preset, and which are enabled at the configuration layer?
- Which Skills are visible in the current workspace and in the current main session's preset scope, where do they come from, and may users or models invoke them?
- Why does the same name appear more than once, which version is effective, and which versions are overridden?

**Why it helps**: no more digging through configuration files or guessing from memory. MCP entries carry scope and source labels, and Skills also carry an invocation policy; same-name entries in different scopes are shown separately instead of being merged into a misleading "global" item.

**Boundary**: read-only overview. It does not enable or disable MCP servers, install plugins, change configuration, or write files; it also does not read external CLI configs such as `~/.cursor`, `~/.kimi-code`, or `~/.config/mcp`.

> **The current capability baseline is Desktop 0.2.1-rc.5.** MCP connection status always reads **Unknown**, there are no tool counts, and there is no tool-probe entry point. Those capabilities appear only when the official managed service becomes available. See "Data scope and current limitations" below.

## Features

| Capability | MCP tab | Skills tab |
| --- | --- | --- |
| Search | By name | By name, description, or when to use |
| Filters | Enabled state (Enabled / Disabled / All; default Enabled) and connection status (only "Unknown" on rc.5) | Source (All sources plus each source) and invocation mode (All / user-invocable / model-invocable / not invocable) |
| Entry scope | Labeled "DSH profile root" or "Preset: <name>"; same-name entries in different scopes are listed separately | Overridden versions of a same-name Skill appear only in the effective entry's detail |
| Inline detail | Connection status (always Unknown on rc.5), scope, source, configured flag | Description, when to use, source, path, invocation policy, overridden versions and the source that overrides them |
| Refresh | Manual refresh plus last-refreshed time; a failed refresh keeps the last snapshot and shows a stale notice | Same |
| Context | — | Follows the selected workspace (`cwd`) and the main session's preset scope; refetches on change |
| Bilingual | zh/en strings follow the host language; entry names are never translated | Same |
| Keyboard | Inline expansion uses real buttons (`aria-expanded` / `aria-controls`) | Same |

- **Scopes are never merged**: MCP entries are labeled "DSH profile root" or "Preset: <name>"; a same-name entry in two scopes is two different configuration items and is listed twice.
- **Honest empty states**: "not configured" is shown only when the profile root and every preset were read completely and declare no MCP server; otherwise the UI falls back to the neutral empty state.
- **Context-aware**: Skills follow the current workspace and the main session's preset scope, and refetch when either changes.

## Quick start

### Requirements

| Dependency | Requirement |
| --- | --- |
| Node.js | `^22.19.0 \|\| >=24` |
| pnpm | Used to install dependencies and build the project |
| DSH / Desktop engine | `>=0.2.1-rc.1 <0.3.0-0` |
| Manual acceptance baseline | Desktop `0.2.1-rc.5` |
| Generic CLI | A working `dsh` command (for CLI installation) |

### Install with the generic CLI (non-desktop profile)

```bash
# 1. Clone the repository
git clone https://github.com/ECHOUniverse/toolscontrol-dsh.git
cd toolscontrol-dsh

# 2. Install dependencies and build
pnpm install
pnpm build

# 3. Link the local directory into <profile> using its absolute path
dsh plugin --profile <profile> add link:/absolute/path/to/toolscontrol-dsh
```

> **Never use `desktop` as `<profile>`.** `desktop` is a reserved profile owned exclusively by the Desktop (Electron) app, and the generic `dsh` CLI rejects it outright. The desktop profile is managed only by the Desktop app itself.

<details>
<summary>Why can the generic CLI not use the desktop profile?</summary>

Verbatim rc.5 error:

```text
error: profile "desktop" is managed exclusively by the Electron application
```

The carrier CLI bundled with Desktop also requires fully quitting Desktop first.

</details>

### Install inside the Desktop app

Plugins page → **Add plugin / Install third-party plugin**. Desktop rc.5's bundled official documentation says the dialog accepts a **package name, Git URL, tarball, or local absolute path** (spec forms accepted by `pnpm add`), and only packages declaring a bundle patch; this plugin's `cordis.patch.yml` satisfies that requirement.

> **Not yet manually verified on a real machine**: this GUI install flow has not been verified item by item for this plugin on a real Desktop. See [docs/DESKTOP-ACCEPTANCE.md](./docs/DESKTOP-ACCEPTANCE.md) for the checklist.

<details>
<summary>What does installation actually mount?</summary>

Installation mounts both halves at once:

- **Host half**: `cordis.patch.yml` inserts the `toolscontrol` entry into the profile composition and registers the read-only `/toolscontrol` routes.
- **Client half**: the `dsh.client` manifest declares the web platform and immediate loading, registering the MCP and Skills tabs on the Plugins page.

After uninstallation both tabs disappear with the package, and the `/toolscontrol/*` routes are no longer reachable.

</details>

### Where to find it

After installation, open the Plugins page (Plugins in the sidebar) and look to the right of **Discover** for **MCP** and **Skills**. Tab labels follow the host language.

- With a workspace selected, the Skills tab header shows "Current workspace: …" and fetches for that `cwd`.
- With no main session it shows "No workspace selected — showing global skills; the project directory is unknown", lists the global registry only, and never guesses a default directory.
- With a main session but an unknown project directory it states the session and preset scope explicitly instead of passing the result off as global.

### Uninstall

```bash
dsh plugin --profile <profile> remove @hanxu131/toolscontrol-dsh
```

You can also remove the corresponding composition package from the Desktop Plugins page. After uninstallation the MCP / Skills tabs disappear and the `/toolscontrol/*` routes are no longer reachable.

## Data scope and current limitations

### MCP: profile root plus presets

MCP data comes from the `pluginInventory` config layer (`mode: "config"`) and merges two composition surfaces:

- **Profile root** `entries`: Loader entries in the current Desktop profile's root composition, labeled "DSH profile root".
- **Preset compositions** `agentPresets[].rows`: rows declared inside each agent preset, labeled "Preset: <name>". In current DSH the session preset layer is where model-facing plugins actually run, so an MCP server configured only inside a preset must still appear.

Processing rules:

- Deduplication keeps only the first entry per `(scope, preset id, entry name)`, and the number of ignored duplicates is written to the page warnings; **the same name in different scopes is not a duplicate** and both entries are listed.
- A preset row without a Loader `entryId` falls back to the module name.
- When `disabled` is an expression it cannot be resolved statically, so the row is labeled "Conditionally enabled" rather than claiming it is enabled or disabled.
- `enabled` accepts only a boolean or `'conditional'`; a missing or other-typed value never defaults to enabled — the row is skipped with a warning.
- Malformed data (`agentPresets` not an array, a preset without an id, `rows` not an array, unparsable rows) is skipped item by item with a warning; the snapshot never fails as a whole.

### MCP: rc.5 capability boundary

| Capability | Desktop 0.2.1-rc.5 | Behavior |
| --- | --- | --- |
| Connection-status observation | unavailable | every entry shows "Unknown"; process / loader phases are never presented as connection status |
| Tool counts | unavailable | hidden |
| Tool probing (probe) | unavailable | no "Load tool list" button; the page shows a capability-degradation note and never probes automatically |

On rc.5 an MCP entry's source cannot be reliably confirmed, so it always shows Unknown; no specific source such as Global is fabricated.

Only when the official `mcpManager` managed mode (`mode: "managed"`) becomes available will real connection statuses and tool counts appear; "Load tool list" will live inside the row detail and fire a POST by name only on explicit user click, never touching configuration. **The current version does not have these capabilities.**

### Honest empty state

When the profile root and every preset were read completely and genuinely declare no MCP server, the empty state says:

> No MCP server is configured in the current DSH profile or its presets (DSH-internal sources only; external CLI configs are not read)

That is a conclusion about a complete readable snapshot, not a claim about any external CLI on the machine. If any source is unavailable or a composition surface or row cannot be parsed, the snapshot carries `canAssertEmpty=false`, the UI falls back to the neutral empty state with the warnings, and it never claims "not configured".

### Skills: visible scope and overridden versions

- Skills use the current main session's live Agent preset scope as the session-level discovery context and the currently selected workspace on the left as the project-level discovery context; only with no main session do they fall back to the global scope. **Visible does not mean loaded.**
- The main list shows only the effective Skill; an overridden version of the same name appears only in the effective entry's detail and never as an independent main row.
- **Overridden versions are not guaranteed to be complete**: competing versions from the plugin runtime, presets, and custom directories cannot be fully enumerated. The enumeration-limit note returned by the host always appears in "Notes".
- A single-source failure never blanks the page: existing data is kept with a stale notice; only a true request failure with no previous data shows the error empty state.

### What this plugin does not do

- Does not enable or disable MCP, install or uninstall MCP servers, change configuration, or write files.
- Does not read external CLI configs such as `~/.cursor`, `~/.kimi-code`, or `~/.config/mcp`, and adds no external MCP adapters.
- Does not put MCP env / headers / token / command / URL material on the wire.
- Does not read or display Skill body content.

## Security model

- Host routes are mounted same-origin under `/toolscontrol`: `health` is the only public endpoint and contains plugin identity only; `overview` / `mcp/probe` pass the official `connection.requestRejection` trust fence (authentication + Host / Origin / `sec-fetch-site`).
- Wire payloads never carry MCP env / headers / token / command / URL material; the Client uses same-origin `fetch` only and reads no configuration files.
- MCP data comes only from DSH's own composition (`pluginInventory`); external CLI configs are not read.
- The Client renders no sensitive configuration and has no Switch-style mutation controls; there are no configuration-writing or file-writing routes.
- Probing exists only in the future managed mode, fires by name only after an explicit user click, and changes no configuration; rc.5 has no probe entry point.

## Local development

```bash
pnpm install
pnpm build       # tsc → Host lib/ + esbuild → lib/client.js envelope
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest: host behavior + client controller/view model + artifact contract
pnpm smoke       # offline artifact smoke: envelope execution, both tab ids, react external, no auto probe
pnpm verify      # clean → build → typecheck → test → smoke
pnpm pack        # publish-package preview
```

Tests and smoke are fully offline: transport is injected, with no Desktop access and no network.

## Project layout

```text
.
├── src/
│   ├── index.ts              # Host half entry: late-bound mounting and route registration
│   ├── host/                 # aggregation, MCP, Skills, routes, warnings
│   ├── client/               # React views, controller, i18n, workspace tracking
│   ├── shared/protocol.ts    # wire contract shared by both halves
│   └── client.tsx            # Client half entry
├── scripts/
│   ├── build-client.mjs      # builds the browser envelope
│   └── smoke.mjs             # offline artifact smoke
├── docs/DESKTOP-ACCEPTANCE.md
├── cordis.patch.yml          # bundle patch: inserts the Host half into the profile composition
├── lib/                      # build output (pnpm build)
├── tests/                    # vitest
└── package.json
```

<details>
<summary>Build artifacts</summary>

- `lib/index.js` — Host half: late-bound mounting of pluginInventory / skills / mcpManager / webServer+connection, registering the read-only `/toolscontrol` routes.
- `lib/client.js` — Client half: a `window.__ModuleLoader__.load({id, factory})` envelope; react / react-dom / cordis and friends stay external (host module table) — no second React is bundled.
- `src/client/controller.ts` — the public controller for search / filter / detail / workspace tracking (the test seam; no React component interaction tests).

</details>

## Manual acceptance and getting help

- **GUI behavior and real Desktop integration have not been automatically verified**: automated coverage stops at unit / behavior tests, artifact contract tests, and offline smoke. The real-machine manual checklist is [docs/DESKTOP-ACCEPTANCE.md](./docs/DESKTOP-ACCEPTANCE.md).
- **The Desktop GUI install flow has not been manually verified on a real machine**: it is a first-time verification item for this plugin, not a verified path.
- **Getting help**: ask questions or report problems in [GitHub Issues](https://github.com/ECHOUniverse/toolscontrol-dsh/issues). Include the Desktop version, install method, operating system, and the warnings text from "Notes"; do not paste sensitive configuration.

## Maintainers and license

- Maintainer: hanxu131
- Repository: https://github.com/ECHOUniverse/toolscontrol-dsh
- Package: `@hanxu131/toolscontrol-dsh`
- Current version: 0.1.0
- License: Apache-2.0 (as declared in `package.json`)
