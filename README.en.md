<div align="center">

# toolscontrol-dsh

**A read-only configuration overview for MCP and Skills in the DSH Desktop Plugins page, with on-demand manual MCP tool probing**

`@hanxu131/toolscontrol-dsh` · v0.1.0

[![version](https://img.shields.io/github/package-json/v/ECHOUniverse/toolscontrol-dsh?label=version)](https://github.com/ECHOUniverse/toolscontrol-dsh)
[![node](https://img.shields.io/badge/node-%5E22.19.0%20%7C%7C%20%3E%3D24-339933.svg)](https://nodejs.org/)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](https://www.apache.org/licenses/LICENSE-2.0)
[![DSH Desktop](https://img.shields.io/badge/DSH%20Desktop-%3E%3D0.2.1--rc.1%20%3C0.3.0--0-blueviolet.svg)](https://github.com/ECHOUniverse/toolscontrol-dsh)

[中文](./README.md) · [Desktop acceptance checklist](./docs/DESKTOP-ACCEPTANCE.md)

</div>

## What it is

`toolscontrol-dsh` is a standalone plugin for DSH Desktop. Once installed, it adds two tabs — **MCP** and **Skills** — to the right of **Discover** on the Plugins page, bringing the current Desktop's MCP entries and Skills into one place. The configuration overview is read-only; MCP tool probing opens an independent, short-lived connection only when the user explicitly asks for it.

It answers four questions:

- Which MCP servers are configured in the current DSH profile root and in each agent preset, and which are enabled at the configuration layer?
- Which Skills are visible in the current workspace and in the current main session's preset scope, where do they come from, and may users or models invoke them?
- Why does the same name appear more than once, which version is effective, and which versions are overridden?
- Can an enabled MCP entry actually connect under its declared configuration, and which tools can it enumerate? (This is a manual, point-in-time probe result — not live connection status.)

**Why it helps**: no more digging through configuration files, guessing from memory, or leaving the page just to test a connection. MCP entries carry scope and source, and enabled probeable entries add a manual probe entry point; Skills also carry an invocation policy. Same-name entries in different scopes are shown separately instead of being merged into a misleading "global" item.

**Boundary**: configuration is read-only. It does not enable or disable MCP servers, install plugins, change configuration, or write files; it also does not read external CLI configs such as `~/.cursor`, `~/.kimi-code`, or `~/.config/mcp`. **Connection probing is not side-effect free**: when the user explicitly probes, the plugin builds an independent short-lived connection from the entry's declared configuration, which may make network requests; `stdio` entries start a short-lived child process. None of this happens unless a probe is triggered.

> **The current capability and acceptance baseline is Desktop 0.2.2-rc.1.** On that build, MCP connection status is still unobservable from static configuration, so it always reads **Unknown**; a connection probe is an independent point-in-time result and cannot replace connection status. Connection probing is implemented and passes automated build, typecheck, tests, and offline smoke; see [docs/DESKTOP-ACCEPTANCE.md](./docs/DESKTOP-ACCEPTANCE.md) for real-machine acceptance progress.

## Features

| Capability | MCP tab | Skills tab |
| --- | --- | --- |
| Search | By name | By name, description, or when to use |
| Filters | Enabled state (Enabled / Disabled / All; default Enabled) and connection status (only "Unknown" on rc.1) | Source (All sources plus each source) and invocation mode (All / user-invocable / model-invocable / not invocable) |
| Entry scope | Labeled "DSH profile root" or "Preset: <name>"; same-name entries in different scopes are listed separately | Overridden versions of a same-name Skill appear only in the effective entry's detail |
| Inline detail | Connection status (always Unknown on rc.1), scope, source, configured flag; a "Probe" entry point only for enabled, probeable entries | Description, when to use, source, path, invocation policy, overridden versions and the source that overrides them |
| Connection probe | Single manual probe plus "Probe all" over the current filtered results; opening the page never probes; results include time, tool count, expandable tool names, or a redacted error | — |
| Probe results | Current browser page session only; displayed separately from connection status; never persisted | — |
| Refresh | Manual refresh plus last-refreshed time; a failed refresh keeps the last snapshot and shows a stale notice | Same |
| Context | — | Follows the selected workspace (`cwd`) and the main session's preset scope; refetches on change |
| Bilingual | zh/en strings follow the host language; entry names are never translated | Same |
| Keyboard | Inline expansion uses real buttons (`aria-expanded` / `aria-controls`) | Same |

- **Scopes are never merged**: MCP entries are labeled "DSH profile root" or "Preset: <name>"; a same-name entry in two scopes is two different configuration items and is listed twice.
- **Honest empty states**: "not configured" is shown only when the profile root and every preset were read completely and declare no MCP server; otherwise the UI falls back to the neutral empty state.
- **Context-aware**: Skills follow the current workspace and the main session's preset scope, and refetch when either changes.
- **Only the user triggers a probe**: opening the page, refreshing, or changing filters or workspace never probes; both single probe and "Probe all" target only enabled, probeable entries, and "Probe all" is scoped to the current filtered results.
- **A probe is not connection status**: a successful probe only means a handshake and tool enumeration succeeded at that moment under the declared configuration; it does not mean the current DSH instance is connected. Connection status is still shown separately from runtime observation and remains "Unknown" on rc.1.

## Quick start

### Requirements

| Dependency | Requirement |
| --- | --- |
| Node.js | `^22.19.0 \|\| >=24` |
| pnpm | Used to install dependencies and build the project |
| DSH / Desktop engine (package floor) | `>=0.2.1-rc.1 <0.3.0-0` |
| Manual acceptance baseline | Desktop `0.2.2-rc.1` (not the minimum runtime) |
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

Verbatim error observed on rc.5:

```text
error: profile "desktop" is managed exclusively by the Electron application
```

The carrier CLI bundled with Desktop also requires fully quitting Desktop first.

</details>

### Install inside the Desktop app

Plugins page → **Add plugin / Install third-party plugin**. Desktop's bundled official documentation (confirmed on rc.5) says the dialog accepts a **package name, Git URL, tarball, or local absolute path** (spec forms accepted by `pnpm add`), and only packages declaring a bundle patch; this plugin's `cordis.patch.yml` satisfies that requirement.

> **Not yet manually verified on a real machine**: this GUI install flow has not been verified item by item for this plugin on a real Desktop. See [docs/DESKTOP-ACCEPTANCE.md](./docs/DESKTOP-ACCEPTANCE.md) for the checklist.

<details>
<summary>What does installation actually mount?</summary>

Installation mounts both halves at once:

- **Host half**: `cordis.patch.yml` inserts the `toolscontrol` entry into the profile composition and registers the `/toolscontrol` routes (no configuration- or file-writing routes).
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

The MCP data for the configuration overview comes from the `pluginInventory` config layer (`mode: "config"`) and merges two composition surfaces:

- **Profile root** `entries`: Loader entries in the current Desktop profile's root composition, labeled "DSH profile root".
- **Preset compositions** `agentPresets[].rows`: rows declared inside each agent preset, labeled "Preset: <name>". In current DSH the session preset layer is where model-facing plugins actually run, so an MCP server configured only inside a preset must still appear.

Processing rules:

- Deduplication keeps only the first entry per `(scope, preset id, entry name)`, and the number of ignored duplicates is written to the page warnings; **the same name in different scopes is not a duplicate** and both entries are listed.
- A preset row without a Loader `entryId` falls back to the module name.
- When `disabled` is an expression it cannot be resolved statically, so the row is labeled "Conditionally enabled", treated as unprobeable, and never claimed to be enabled or disabled.
- `enabled` accepts only a boolean or `'conditional'`; a missing or other-typed value never defaults to enabled — the row is skipped with a warning.
- Malformed data (`agentPresets` not an array, a preset without an id, `rows` not an array, unparsable rows) is skipped item by item with a warning; the snapshot never fails as a whole.

### MCP: rc.1 capability boundary

| Capability | Desktop 0.2.2-rc.1 | Behavior |
| --- | --- | --- |
| Connection-status observation | unobservable from static configuration | every entry shows "Unknown"; fiberPhase, tool presence, plugin load state, and probe results are never presented as connection status |
| Tool counts | no live tool counts | shown only in a manual connection probe's result, as the number enumerated at that moment |
| Connection probe | designed as available; an independent short-lived connection from the declared configuration | user-triggered only; never automatic on page open |

On rc.1 an MCP entry's source still cannot be reliably confirmed, so it always shows Unknown; no specific source such as Global is fabricated. Connection probing relies on DSH internal faces (loader / agentPresets and others), which are not a stable public API; when an interface is missing, only probing degrades — the configuration overview is unaffected, and the interface's presence must never be read as connection status.

### MCP: connection probing

**What the result means**: a connection probe opens one independent short-lived connection using the entry's declared configuration, completes the MCP handshake and tool enumeration, then ends. A successful handshake plus tool enumeration counts as success; no Tools capability or zero tools still counts as success. The result is a point-in-time snapshot, not connection status, and it does not update automatically with runtime changes.

**How it is triggered**:

- Single probe: an explicit "Probe" click in the row detail of an enabled, probeable entry.
- Probe all: probes each enabled, probeable entry in the current filtered results one by one; the scope follows the filters and excludes disabled or unprobeable entries.
- Opening the page, refreshing, or changing filters / workspace / session never triggers a probe; no automatic probe exists anywhere in the page.

**Execution constraints**:

- Each probe times out after 10 seconds.
- Concurrency is capped at 2; while a probe for an entry is running, new triggers for that entry are ignored rather than starting a duplicate concurrent probe.
- Cancelling a probe, leaving the page, or unloading the plugin must clean up in-flight connections and `stdio` child processes.

**Supported range**:

- Transports: `streamable-http` and `stdio`; version negotiation (`versionNegotiation`) uses `auto`.
- `stdio` entries start a short-lived child process; it must be terminated when the probe ends or is cancelled, or when the page is left or the plugin is unloaded, leaving no persistent process.

**Results and lifetime**:

- Results live only in the current browser page session (not a DSH session); they are not guaranteed to survive leaving the page and are never written to configuration or persisted.
- Each result includes the probe time, tool count, and expandable tool names; failures show a redacted error instead.
- Probe results are displayed separately from connection status: a successful probe must not render as "Connected", and a failed probe must not render as a runtime "Failed".

**Credentials and data boundary**:

- MCP credentials are used only in Host memory and never enter the Client DTO, logs, persistence, or error details.
- The Client sends only the entry name when probing; env / headers / token / command / URL configuration never enters the wire payload.

**Dependencies and degradation**:

- Connection probing pins `@modelcontextprotocol/client` 2.2.0 and reads DSH's loader / agentPresets internal faces.
- When a required internal interface is missing, or the transport or configuration is unsupported, or a preset's dynamic configuration cannot be reliably evaluated, the entry is marked "Unprobeable" with a reason; probing degradation does not affect the MCP configuration overview or other entries.
- Those internal faces are not a stable public API, and no stable public API currently exposes MCP runtime status; interface availability or a successful probe must never be presented as connection status.

**When an entry is unprobeable**:

- The entry is disabled.
- A required internal interface is missing.
- The transport or configuration is unsupported.
- The preset's dynamic configuration cannot be reliably evaluated.

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
- Tool probing happens only on an explicit user click: opening the page, refreshing, or changing filters / workspace / session triggers no probe, and there is no background polling.
- Does not persist probe results or credentials, and never writes a probe result back as connection status.
- Does not read or display Skill body content.

## Security model

- Host routes are mounted same-origin under `/toolscontrol`: `health` is the only public endpoint and contains plugin identity only; `overview` / `mcp/probe` pass the official `connection.requestRejection` trust fence (authentication + Host / Origin / `sec-fetch-site`).
- Wire payloads never carry MCP env / headers / token / command / URL material; the Client uses same-origin `fetch` only, reads no configuration files, and sends only the entry name when probing.
- MCP credentials are used only in Host memory and never enter the Client DTO, logs, persistence, or error details; errors must be redacted before they are returned.
- Active probing has external side effects: it may make network requests, and `stdio` entries start a short-lived child process. Each probe times out after 10 seconds, concurrency is capped at 2, and cancelling / leaving the page / unloading the plugin cleans up connections and child processes. Probing changes no configuration.
- Connection status comes only from DSH runtime observation; when rc.1 cannot observe it, it stays "Unknown" and is never imitated by fiberPhase, tool presence, a successful probe, or plugin load state.
- MCP configuration data comes only from DSH's own composition (`pluginInventory`, loader / `agentPresets`, and so on); external CLI configs are not read.
- The Client renders no sensitive configuration and has no Switch-style mutation controls; there are no configuration-writing or file-writing routes.

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

Tests and smoke are designed to run offline: transport is injected, with no Desktop access and no network.

## Project layout

```text
.
├── src/
│   ├── index.ts              # Host half entry: late-bound mounting and route registration
│   ├── host/                 # aggregation, MCP configuration and probing, Skills, routes, warnings
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

- `lib/index.js` — Host half: late-bound mounting of pluginInventory / skills / webServer+connection, registering the `/toolscontrol` routes (no configuration- or file-writing routes).
- `lib/client.js` — Client half: a `window.__ModuleLoader__.load({id, factory})` envelope; react / react-dom / cordis and friends stay external (host module table) — no second React is bundled.
- `src/client/controller.ts` — the public controller for search / filter / detail / workspace tracking (the test seam; no React component interaction tests).

</details>

## Manual acceptance and getting help

- **GUI behavior and real Desktop integration have not been automatically verified**: automated coverage stops at unit / behavior tests, artifact contract tests, and offline smoke. The real-machine manual checklist is [docs/DESKTOP-ACCEPTANCE.md](./docs/DESKTOP-ACCEPTANCE.md), with Desktop 0.2.2-rc.1 as the acceptance baseline.
- **Connection probing has partial real-machine evidence**: a 2026-11-11 screenshot confirms a successful manual streamable-http probe of `include:mcp-anysearch`, showing five tools. Other entry types, failure, cancellation, and cleanup paths still require individual acceptance; do not tick an item that was not actually executed.
- **The Desktop GUI install flow has not been manually verified on a real machine**: it is a first-time verification item for this plugin, not a verified path.
- **Getting help**: ask questions or report problems in [GitHub Issues](https://github.com/ECHOUniverse/toolscontrol-dsh/issues). Include the Desktop version, install method, operating system, and the warnings text from "Notes"; do not paste sensitive configuration.

## Maintainers and license

- Maintainer: hanxu131
- Repository: https://github.com/ECHOUniverse/toolscontrol-dsh
- Package: `@hanxu131/toolscontrol-dsh`
- Current version: 0.1.0
- License: Apache-2.0 (as declared in `package.json`)
