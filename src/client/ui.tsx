/**
 * React views of the two read-only overview tabs and their registration into
 * the official Plugins page.
 *
 * Verified rc.5 contract (0.2.1-rc.5 asar, `dsh-client-ui-plugin-market`
 * client.js:1622-1628): a Plugins-page tab registers through
 * `ctx.slots.inject('plugins.tab', () => ctx.slots.register(
 * {name:'plugins.tab', id, label, locale, inject}, SectionComponent))`.
 * The page renders the selected section with `{...injectFace, t, install,
 * openPackage}`; `install`/`openPackage` are owner props this read-only tab
 * deliberately ignores.
 *
 * Strictly read-only: there is NO Switch/toggle/action control — rows expand
 * inline for details (keyboard-reachable buttons with aria-expanded/controls),
 * the only writes on the wire are the explicit probe POST behind the
 * "Load tool list" button, which exists only when the snapshot declares
 * `capabilities.probe`.
 *
 * Services are consumed defensively: the `sessions`/`workspaces` list stores
 * power workspace tracking; a future `remote.mcpManager.watch` (absent in
 * rc.5) would drive refreshes; the official `plugin-manager/changed` event
 * invalidates the snapshot. None of them is a hard runtime dependency beyond
 * the cordis `inject` declaration.
 *
 * @module @hanxu131/toolscontrol-dsh/client/ui
 */
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { ToolscontrolController, type ClientState, type ControllerDeps as ToolscontrolControllerDeps, type ObservableStore, type ProbeState } from './controller.ts'
import { fetchOverview, probeServer } from './api.ts'
import { NS, en, sourceLabel, warningTexts, zh, type MessageTranslate } from './i18n.ts'
import { CSS } from './styles.ts'
import type { McpCapabilities, McpConnectionStatus, McpPresetRef, McpServerEntry, SkillEntry } from '../shared/protocol.ts'
import { mcpEmptyStateKey, skillsScopeLine, type SkillRow } from './view-model.ts'
import type { SessionsListShape, WorkspacesListShape } from './workspace.ts'

/** Translate function bound to this plugin's locale namespace. */
export type TranslateFn = MessageTranslate

/** Locale service face (rc.5 `dsh-client-locale`, consumed subset). */
export interface LocaleFace {
  register(namespace: string, dictionaries: Record<string, Record<string, string>>): () => void
  bind(namespace: string): TranslateFn
  subscribe(listener: () => void): () => void
  getSnapshot(): { readonly active: string; readonly revision: number }
}

/** Slot registry face (rc.5 `dsh-client-ui-slots`, consumed subset). */
export interface SlotsFace {
  inject(slot: string, callback: () => () => void): () => void
  register(options: Record<string, unknown>, component: unknown): () => void
}

/** Remote face (rc.5 `dsh-api-remotes`, consumed subset; all optional). */
export interface RemoteFace {
  /** Official change-event subscription; handlers receive no typed payload here. */
  $on?(event: string, handler: () => void): (() => void) | void
  /** Absent in rc.5; if a future build provides `watch`, it drives refreshes. */
  mcpManager?: { watch?: (listener: () => void) => unknown }
}

/** Minimal client plugin context this bundle's `apply` touches. */
export interface ClientContext {
  locale: LocaleFace
  slots: SlotsFace
  remote?: RemoteFace
  effect(callback: () => void | (() => void), label?: string): () => void
  get?<T = unknown>(name: string): T | undefined
}

/** Props the Plugins page hands a section: injected face + owner props. */
export interface SectionProps {
  readonly tc?: ToolscontrolController
  readonly t?: TranslateFn
  /** Owner props of `plugins.tab` — accepted, never used (read-only tab). */
  readonly install?: unknown
  readonly openPackage?: unknown
  [extra: string]: unknown
}

// ---------------------------------------------------------------------------
// small shared pieces
// ---------------------------------------------------------------------------

/** Install the stylesheet once per application; returns its removal cleanup. */
function installStyles(): (() => void) | undefined {
  if (typeof document === 'undefined') return
  const marker = 'style[data-plugin-css="toolscontrol-tabs"]'
  if (document.querySelector(marker) !== null) return
  const tag = document.createElement('style')
  tag.dataset.plugin = '@hanxu131/toolscontrol-dsh'
  tag.dataset.pluginCss = 'toolscontrol-tabs'
  tag.textContent = CSS
  document.head.appendChild(tag)
  return () => {
    tag.remove()
  }
}

function formatTime(epoch: number, language: string): string {
  try {
    return new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(epoch))
  } catch {
    return String(epoch)
  }
}

/** Safe DOM id fragment (entry names may contain anything). */
function idFragment(value: string): string {
  return encodeURIComponent(value).replace(/[%'()*.!]/g, '_')
}

/**
 * Unique row identity. The same entry name may exist both at the profile root
 * and inside a preset — those are DIFFERENT configuration items, so the key
 * carries the scope and preset id (React keys, expansion state, DOM ids).
 */
function mcpEntryKey(server: McpServerEntry): string {
  return `${server.scope}:${server.preset?.id ?? ''}:${server.name}`
}

/** Human label of a preset reference (official display name when present). */
function presetRefLabel(preset: McpPresetRef): string {
  return preset.name ?? preset.id
}

/** Row scope label: profile root, preset composition, or undeterminable. */
function mcpScopeLabel(server: McpServerEntry, t: TranslateFn): string {
  if (server.scope === 'preset' && server.preset !== undefined) {
    return t('mcp.scope.preset', { name: presetRefLabel(server.preset) })
  }
  if (server.scope === 'profile') return t('mcp.scope.profile')
  return t('mcp.scope.unknown')
}

function initialOf(name: string): string {
  const first = name.trim().charAt(0)
  return first === '' ? '?' : first.toUpperCase()
}

function Dot(props: { tone: string }): ReactNode {
  return <span className="dshTcDot" data-tone={props.tone} aria-hidden="true" />
}

function Tag(props: { tone?: string; children: ReactNode }): ReactNode {
  return (
    <span className="dshTcTag" {...(props.tone !== undefined ? { 'data-tone': props.tone } : {})}>
      {props.children}
    </span>
  )
}

function Notice(props: { children: ReactNode }): ReactNode {
  return (
    <p className="dshTcNotice" role="note">
      <span className="dshTcNoticeText">{props.children}</span>
    </p>
  )
}

function Pill(props: { active: boolean; label: string; title?: string; onClick: () => void; children: ReactNode }): ReactNode {
  return (
    <button
      type="button"
      className="dshTcPill"
      data-active={props.active}
      aria-pressed={props.active}
      aria-label={props.label}
      title={props.title}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  )
}

function statusLabel(status: McpConnectionStatus, t: TranslateFn): string {
  const key = `mcp.status.${status}`
  const label = t(key)
  return label === key ? status : label
}

function statusTone(status: McpConnectionStatus, known: boolean): string {
  if (!known) return 'neutral'
  switch (status) {
    case 'connected':
      return 'success'
    case 'connecting':
    case 'reconnecting':
      return 'info'
    case 'failed':
      return 'error'
    case 'disabled':
      return 'neutral'
    default:
      return 'neutral'
  }
}

/** Skeleton lines shown while the first snapshot loads. */
function Skeleton(): ReactNode {
  return (
    <div aria-hidden="true">
      <span className="dshTcSkeletonBar dshTcSkeletonTitle" />
      <span className="dshTcSkeletonBar dshTcSkeletonLine" />
      <span className="dshTcSkeletonBar dshTcSkeletonLine" />
    </div>
  )
}

/** No-op store seam so hooks run unconditionally even without a controller.
 *  The snapshot value is never read in that state (the section returns null). */
const NOOP_SUBSCRIBE = (_listener: () => void): (() => void) => () => {}
const NOOP_GET_SNAPSHOT = (() => null) as unknown as () => ClientState

/** Shared toolbar: search + manual refresh + last-refreshed time. */
function Toolbar(props: {
  query: string
  placeholder: string
  ariaLabel: string
  busy: boolean
  lastRefreshedAt: number | null
  language: string
  onQuery: (query: string) => void
  onRefresh: () => void
  t: TranslateFn
}): ReactNode {
  const { t } = props
  return (
    <>
      <div className="dshTcToolbar">
        <input
          type="search"
          className="dshTcSearch"
          value={props.query}
          placeholder={props.placeholder}
          aria-label={props.ariaLabel}
          onChange={(event) => {
            props.onQuery(event.currentTarget.value)
          }}
        />
        <button type="button" className="dshTcBtn" onClick={props.onRefresh} disabled={props.busy} aria-label={t('common.refresh')}>
          {props.busy ? <Dot tone="ongoing" /> : null}
          {t('common.refresh')}
        </button>
      </div>
      {props.lastRefreshedAt !== null ? (
        <div className="dshTcMetaLine">
          <span className="dshTcMeta">{t('status.lastRefreshed', { time: formatTime(props.lastRefreshedAt, props.language) })}</span>
        </div>
      ) : null}
    </>
  )
}

/**
 * Body switch shared by both tabs. Empty-state wording follows the FILTERED
 * rows: zero filtered rows over an empty snapshot scope is the true empty
 * state; zero filtered rows over present data means the filters hid
 * everything (never silently renders an empty list).
 */
function ListBody(props: {
  state: ClientState
  /** Filtered+sorted row count actually about to render. */
  rowsCount: number
  /** Raw entry count in the snapshot (before filters). */
  rawCount: number
  /** Wording for the true empty state (tab-specific honesty); defaults to neutral. */
  emptyText?: string
  children: ReactNode
  onRetry: () => void
  t: TranslateFn
}): ReactNode {
  const { state, t } = props
  if (state.snapshot === null) {
    if (state.status === 'error') {
      return (
        <div className="dshTcEmpty">
          <p className="dshTcErrorText" role="alert">
            <Dot tone="error" />
            {t('state.errorTitle')}
          </p>
          {state.error !== null ? <p className="dshTcMuted">{state.error}</p> : null}
          <button type="button" className="dshTcBtn" onClick={props.onRetry}>
            {t('common.retry')}
          </button>
        </div>
      )
    }
    return <Skeleton />
  }
  if (props.rowsCount === 0) {
    return (
      <p className="dshTcMeta">{props.rawCount === 0 ? (props.emptyText ?? t('state.emptyAll')) : t('state.emptyFiltered')}</p>
    )
  }
  return <>{props.children}</>
}

// ---------------------------------------------------------------------------
// MCP tab
// ---------------------------------------------------------------------------

function McpRow(props: {
  server: McpServerEntry
  capabilities: McpCapabilities
  probe: ProbeState | undefined
  expanded: boolean
  idBase: string
  onToggle: () => void
  onProbe: (server: string) => void
  t: TranslateFn
}): ReactNode {
  const { server, capabilities, probe, t } = props
  const entryKey = mcpEntryKey(server)
  const detailId = `${props.idBase}-${idFragment(entryKey)}-detail`
  const statusKnown = capabilities.connectionStatus === true
  const toolCountKnown = capabilities.toolCount === true && typeof server.toolCount === 'number'
  return (
    <li className="dshTcRow" data-mcp-entry={server.name} data-mcp-scope={server.scope}>
      <div className="dshTcRowHead">
        <span className="dshTcRowIcon" aria-hidden="true">
          {initialOf(server.name)}
        </span>
        <div className="dshTcRowMain">
          <div className="dshTcTitleRow">
            <button
              type="button"
              className="dshTcRowOpen"
              aria-expanded={props.expanded}
              aria-controls={detailId}
              onClick={props.onToggle}
            >
              <span className="dshTcChevron" data-expanded={props.expanded} aria-hidden="true">
                ▸
              </span>
              {server.name}
            </button>
            {server.conditional === true ? (
              <Tag tone="info">{t('mcp.entryConditional')}</Tag>
            ) : server.enabled ? (
              <Tag tone="success">{t('mcp.entryEnabled')}</Tag>
            ) : (
              <Tag>{t('mcp.entryDisabled')}</Tag>
            )}
          </div>
          <div className="dshTcTags">
            <Tag tone={statusTone(server.status, statusKnown)}>
              <Dot tone={statusKnown ? statusTone(server.status, true) : 'idle'} />
              {statusKnown ? statusLabel(server.status, t) : t('mcp.status.unknown')}
            </Tag>
            <Tag tone={server.scope === 'preset' ? 'info' : undefined}>{mcpScopeLabel(server, t)}</Tag>
            <Tag>{sourceLabel(server.source, t)}</Tag>
            {toolCountKnown ? <Tag>{t('mcp.tools', { n: server.toolCount as number })}</Tag> : null}
          </div>
        </div>
      </div>
      {props.expanded ? (
        <div className="dshTcDetail" id={detailId} role="region" aria-label={t('mcp.detailFor', { name: server.name })}>
          <dl className="dshTcFacts">
            <div>
              <dt>{t('field.status')}</dt>
              <dd>{statusKnown ? statusLabel(server.status, t) : t('mcp.status.unknown')}</dd>
            </div>
            <div>
              <dt>{t('mcp.scopeLabel')}</dt>
              <dd>{mcpScopeLabel(server, t)}</dd>
            </div>
            <div>
              <dt>{t('field.source')}</dt>
              <dd>{sourceLabel(server.source, t)}</dd>
            </div>
            <div>
              <dt>{t('mcp.configured')}</dt>
              <dd>{server.configured ? t('common.yes') : t('common.no')}</dd>
            </div>
            {toolCountKnown ? (
              <div>
                <dt>{t('field.tools')}</dt>
                <dd>{String(server.toolCount)}</dd>
              </div>
            ) : null}
          </dl>
          {capabilities.probe === true ? (
            <div className="dshTcProbe">
              <button
                type="button"
                className="dshTcBtn"
                disabled={probe?.phase === 'loading'}
                onClick={() => {
                  props.onProbe(server.name)
                }}
              >
                {probe?.phase === 'loading' ? (
                  <>
                    <Dot tone="ongoing" />
                    {t('mcp.probing')}
                  </>
                ) : (
                  t('mcp.loadTools')
                )}
              </button>
              {probe?.phase === 'ok' ? (
                probe.toolNames.length === 0 ? (
                  <span className="dshTcMuted">{t('mcp.probeEmpty')}</span>
                ) : (
                  <ul className="dshTcToolList">
                    {probe.toolNames.map((tool) => (
                      <li key={tool}>
                        <code className="dshTcCode">{tool}</code>
                      </li>
                    ))}
                  </ul>
                )
              ) : null}
              {probe?.phase === 'failed' ? (
                <span className="dshTcErrorText" role="alert">
                  {t('mcp.probeFailed', { message: probe.message ?? '' })}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  )
}

/** The MCP tab body: filters, capability degradation, compact rows. */
export function McpSection(props: SectionProps): ReactNode {
  const tc = props.tc
  const t = props.t
  const [expanded, setExpanded] = useState<string | null>(null)
  const state = useSyncExternalStore(tc?.subscribe ?? NOOP_SUBSCRIBE, tc?.getSnapshot ?? NOOP_GET_SNAPSHOT, tc?.getSnapshot ?? NOOP_GET_SNAPSHOT)
  useEffect(() => {
    tc?.ensure()
  }, [tc])
  if (tc === undefined || t === undefined) return null
  const snapshot = state.snapshot
  const mcp = snapshot?.mcp
  const warningLines = mcp === undefined ? [] : warningTexts(mcp.warnings, mcp.warningItems, t)
  const busy = state.status === 'loading'
  return (
    <div className="dshTc" data-plugin-tab="toolscontrol-mcp">
      <Toolbar
        query={state.mcpFilters.query}
        placeholder={t('search.mcpPlaceholder')}
        ariaLabel={t('search.aria.mcp')}
        busy={busy}
        lastRefreshedAt={state.lastRefreshedAt}
        language={state.language}
        onQuery={(query) => {
          tc.setMcpFilters({ query })
        }}
        onRefresh={() => {
          tc.refresh()
        }}
        t={t}
      />
      <div className="dshTcPills" role="group" aria-label={t('filter.enabled')}>
        <Pill
          active={state.mcpFilters.enabled === 'enabled'}
          label={t('filter.enabled.on')}
          onClick={() => {
            tc.setMcpFilters({ enabled: 'enabled' })
          }}
        >
          {t('filter.enabled.on')}
        </Pill>
        <Pill
          active={state.mcpFilters.enabled === 'disabled'}
          label={t('filter.enabled.off')}
          onClick={() => {
            tc.setMcpFilters({ enabled: 'disabled' })
          }}
        >
          {t('filter.enabled.off')}
        </Pill>
        <Pill
          active={state.mcpFilters.enabled === 'all'}
          label={t('common.all')}
          onClick={() => {
            tc.setMcpFilters({ enabled: 'all' })
          }}
        >
          {t('common.all')}
        </Pill>
      </div>
      {state.mcpStatusOptions.length > 0 ? (
        <div className="dshTcPills" role="group" aria-label={t('filter.status')}>
          <Pill
            active={state.mcpFilters.status === 'all'}
            label={t('common.all')}
            onClick={() => {
              tc.setMcpFilters({ status: 'all' })
            }}
          >
            {t('common.all')}
          </Pill>
          {state.mcpStatusOptions.map((status) => (
            <Pill
              key={status}
              active={state.mcpFilters.status === status}
              label={statusLabel(status, t)}
              onClick={() => {
                tc.setMcpFilters({ status })
              }}
            >
              {statusLabel(status, t)}
            </Pill>
          ))}
        </div>
      ) : null}
      {mcp !== undefined && mcp.capabilities.connectionStatus === false ? <Notice>{t('mcp.capabilityNote')}</Notice> : null}
      {mcp !== undefined && warningLines.length > 0 ? (
        <Notice>
          {t('warnings.title')}: {warningLines.join(' · ')}
        </Notice>
      ) : null}
      {state.error !== null && state.stale ? <Notice>{t('state.staleNotice', { message: state.error })}</Notice> : null}
      <ListBody
        state={state}
        rowsCount={state.mcpRows.length}
        rawCount={mcp?.servers.length ?? 0}
        emptyText={t(mcpEmptyStateKey(mcp))}
        onRetry={() => {
          tc.refresh()
        }}
        t={t}
      >
        <ul className="dshTcRows" aria-busy={busy}>
          {state.mcpRows.map((server) => {
            const entryKey = mcpEntryKey(server)
            return (
              <McpRow
                key={entryKey}
                server={server}
                capabilities={mcp!.capabilities}
                probe={state.probes[server.name]}
                expanded={expanded === entryKey}
                idBase="tc-mcp"
                onToggle={() => {
                  setExpanded((current) => (current === entryKey ? null : entryKey))
                }}
                onProbe={(serverName) => {
                  tc.requestProbe(serverName)
                }}
                t={t}
              />
            )
          })}
        </ul>
      </ListBody>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Skills tab
// ---------------------------------------------------------------------------

function InvocationTags(props: { entry: SkillEntry; t: TranslateFn }): ReactNode {
  const { t } = props
  const { modelInvocable, userInvocable } = props.entry.invocation
  if (modelInvocable && userInvocable) {
    return (
      <>
        <Tag tone="info">{t('filter.invocation.model')}</Tag>
        <Tag tone="info">{t('filter.invocation.user')}</Tag>
      </>
    )
  }
  if (userInvocable) return <Tag tone="info">{t('filter.invocation.user')}</Tag>
  if (modelInvocable) return <Tag tone="info">{t('filter.invocation.model')}</Tag>
  return <Tag>{t('filter.invocation.none')}</Tag>
}

function ShadowedList(props: { row: SkillRow; t: TranslateFn }): ReactNode {
  const { t } = props
  if (props.row.shadowed.length === 0) return null
  return (
    <div className="dshTcShadowed">
      <p className="dshTcShadowedTitle">{t('skills.shadowedTitle', { n: props.row.shadowed.length })}</p>
      {props.row.shadowed.map((shadowed) => (
        <div className="dshTcShadowedRow" key={`${shadowed.name}:${shadowed.source}:${shadowed.path ?? ''}`}>
          <div className="dshTcTitleRow">
            <span>{shadowed.name}</span>
            <Tag>{sourceLabel(shadowed.source, t)}</Tag>
            {shadowed.shadowedBy !== undefined ? (
              <span className="dshTcMuted">{t('skills.shadowedBy', { source: sourceLabel(shadowed.shadowedBy, t) })}</span>
            ) : null}
          </div>
          <span className="dshTcDescription">{shadowed.description}</span>
        </div>
      ))}
    </div>
  )
}

function SkillRowItem(props: {
  row: SkillRow
  expanded: boolean
  idBase: string
  onToggle: () => void
  t: TranslateFn
}): ReactNode {
  const { t } = props
  const entry = props.row.effective
  const detailId = `${props.idBase}-${idFragment(entry?.name ?? String(props.row.shadowed[0]?.name ?? ''))}-detail`
  const displayName = entry?.name ?? props.row.shadowed[0]?.name ?? ''
  return (
    <li className="dshTcRow" data-skill-entry={displayName}>
      <div className="dshTcRowHead">
        <span className="dshTcRowIcon" aria-hidden="true">
          {initialOf(displayName)}
        </span>
        <div className="dshTcRowMain">
          <div className="dshTcTitleRow">
            <button
              type="button"
              className="dshTcRowOpen"
              aria-expanded={props.expanded}
              aria-controls={detailId}
              onClick={props.onToggle}
            >
              <span className="dshTcChevron" data-expanded={props.expanded} aria-hidden="true">
                ▸
              </span>
              {displayName}
            </button>
          </div>
          {entry !== null || props.row.shadowed[0] !== undefined ? (
            <span className="dshTcDescription">{entry?.description ?? props.row.shadowed[0]!.description}</span>
          ) : null}
          <div className="dshTcTags">
            {entry !== null ? <Tag>{sourceLabel(entry.source, t)}</Tag> : null}
            {entry !== null ? <InvocationTags entry={entry} t={t} /> : null}
          </div>
        </div>
      </div>
      {props.expanded ? (
        <div className="dshTcDetail" id={detailId} role="region" aria-label={t('skills.detailFor', { name: displayName })}>
          <dl className="dshTcFacts">
            {entry !== null ? (
              <>
                <div>
                  <dt>{t('field.description')}</dt>
                  <dd>{entry.description}</dd>
                </div>
                {entry.whenToUse !== undefined ? (
                  <div>
                    <dt>{t('field.whenToUse')}</dt>
                    <dd>{entry.whenToUse}</dd>
                  </div>
                ) : null}
                <div>
                  <dt>{t('field.source')}</dt>
                  <dd>{sourceLabel(entry.source, t)}</dd>
                </div>
                <div>
                  <dt>{t('filter.invocation.model')}</dt>
                  <dd>{entry.invocation.modelInvocable ? t('common.yes') : t('common.no')}</dd>
                </div>
                <div>
                  <dt>{t('filter.invocation.user')}</dt>
                  <dd>{entry.invocation.userInvocable ? t('common.yes') : t('common.no')}</dd>
                </div>
                {entry.path !== undefined ? (
                  <div>
                    <dt>{t('field.path')}</dt>
                    <dd>
                      <code className="dshTcCode">{entry.path}</code>
                    </dd>
                  </div>
                ) : null}
              </>
            ) : null}
          </dl>
          <ShadowedList row={props.row} t={t} />
        </div>
      ) : null}
    </li>
  )
}

/** The Skills tab body: workspace line, filters, compact rows. */
export function SkillsSection(props: SectionProps): ReactNode {
  const tc = props.tc
  const t = props.t
  const [expanded, setExpanded] = useState<string | null>(null)
  const state = useSyncExternalStore(tc?.subscribe ?? NOOP_SUBSCRIBE, tc?.getSnapshot ?? NOOP_GET_SNAPSHOT, tc?.getSnapshot ?? NOOP_GET_SNAPSHOT)
  useEffect(() => {
    tc?.ensure()
  }, [tc])
  if (tc === undefined || t === undefined) return null
  const snapshot = state.snapshot
  const skills = snapshot?.skills
  const busy = state.status === 'loading'
  const warningLines = skills === undefined ? [] : warningTexts(skills.warnings, skills.warningItems, t)
  const scopeLine = skillsScopeLine(state.workspace)
  return (
    <div className="dshTc" data-plugin-tab="toolscontrol-skills">
      <Toolbar
        query={state.skillsFilters.query}
        placeholder={t('search.skillsPlaceholder')}
        ariaLabel={t('search.aria.skills')}
        busy={busy}
        lastRefreshedAt={state.lastRefreshedAt}
        language={state.language}
        onQuery={(query) => {
          tc.setSkillsFilters({ query })
        }}
        onRefresh={() => {
          tc.refresh()
        }}
        t={t}
      />
      <div className="dshTcMetaLine">
        <span className="dshTcMeta" title={state.workspace.cwd ?? undefined}>
          {scopeLine.key === 'workspace.title'
            ? t('workspace.title', { title: scopeLine.title })
            : scopeLine.key === 'workspace.sessionNoCwd'
              ? t('workspace.sessionNoCwd', { sessionId: scopeLine.sessionId })
              : t('workspace.none')}
        </span>
      </div>
      <div className="dshTcPills" role="group" aria-label={t('filter.source')}>
        <Pill
          active={state.skillsFilters.source === 'all'}
          label={t('skills.filter.allSources')}
          onClick={() => {
            tc.setSkillsFilters({ source: 'all' })
          }}
        >
          {t('skills.filter.allSources')}
        </Pill>
        {state.skillSourceOptions.map((source) => (
          <Pill
            key={source}
            active={state.skillsFilters.source === source}
            label={sourceLabel(source, t)}
            title={source}
            onClick={() => {
              tc.setSkillsFilters({ source })
            }}
          >
            {sourceLabel(source, t)}
          </Pill>
        ))}
      </div>
      <div className="dshTcPills" role="group" aria-label={t('filter.invocation')}>
        <Pill
          active={state.skillsFilters.invocation === 'all'}
          label={t('skills.filter.allInvocations')}
          onClick={() => {
            tc.setSkillsFilters({ invocation: 'all' })
          }}
        >
          {t('skills.filter.allInvocations')}
        </Pill>
        <Pill
          active={state.skillsFilters.invocation === 'user'}
          label={t('filter.invocation.user')}
          onClick={() => {
            tc.setSkillsFilters({ invocation: 'user' })
          }}
        >
          {t('filter.invocation.user')}
        </Pill>
        <Pill
          active={state.skillsFilters.invocation === 'model'}
          label={t('filter.invocation.model')}
          onClick={() => {
            tc.setSkillsFilters({ invocation: 'model' })
          }}
        >
          {t('filter.invocation.model')}
        </Pill>
        <Pill
          active={state.skillsFilters.invocation === 'none'}
          label={t('filter.invocation.none')}
          onClick={() => {
            tc.setSkillsFilters({ invocation: 'none' })
          }}
        >
          {t('filter.invocation.none')}
        </Pill>
      </div>
      {skills !== undefined && warningLines.length > 0 ? (
        <Notice>
          {t('warnings.title')}: {warningLines.join(' · ')}
        </Notice>
      ) : null}
      {state.error !== null && state.stale ? <Notice>{t('state.staleNotice', { message: state.error })}</Notice> : null}
      <ListBody
        state={state}
        rowsCount={state.skillRows.length}
        rawCount={skills?.skills.length ?? 0}
        onRetry={() => {
          tc.refresh()
        }}
        t={t}
      >
        <ul className="dshTcRows" aria-busy={busy}>
          {state.skillRows.map((row) => {
            const name = row.effective?.name ?? row.shadowed[0]?.name ?? ''
            return (
              <SkillRowItem
                key={name}
                row={row}
                expanded={expanded === name}
                idBase="tc-skills"
                onToggle={() => {
                  setExpanded((current) => (current === name ? null : name))
                }}
                t={t}
              />
            )
          })}
        </ul>
      </ListBody>
    </div>
  )
}

// ---------------------------------------------------------------------------
// registration
// ---------------------------------------------------------------------------

/** Read the official `sessions`/`workspaces` list stores off the context, defensively. */
function listStoreOf(ctx: ClientContext, name: string): ObservableStore<never> | undefined {
  let service: unknown
  try {
    service = typeof ctx.get === 'function' ? ctx.get(name) : undefined
  } catch {
    service = undefined
  }
  if (service === undefined || service === null) {
    service = (ctx as unknown as Record<string, unknown>)[name]
  }
  const list = (service as { list?: unknown } | null | undefined)?.list
  if (list === null || typeof list !== 'object') return undefined
  const store = list as { getSnapshot?: unknown; subscribe?: unknown }
  if (typeof store.getSnapshot !== 'function' || typeof store.subscribe !== 'function') return undefined
  return store as ObservableStore<never>
}

/**
 * Future-environment seam: if the official `mcpManager.watch` exists (absent
 * in rc.5), subscribe it to drive snapshot invalidation. Never a hard
 * dependency; any shape mismatch is ignored silently.
 */
function attachMcpWatch(controller: ToolscontrolController, remote: RemoteFace | undefined): (() => void) | undefined {
  const manager = remote?.mcpManager
  if (manager === undefined || manager === null) return
  const watch = manager.watch
  if (typeof watch !== 'function') return
  try {
    const result = watch.call(manager, () => {
      controller.invalidate()
    })
    return typeof result === 'function' ? (result as () => void) : undefined
  } catch {
    return
  }
}

/** Required client services: slots, copy, remote events, workspace tracking. */
export const inject = ['slots', 'locale', 'remote', 'sessions', 'workspaces'] as const

/**
 * Mount the client half: dictionaries, styles, the shared controller (whose
 * lifecycle is one plugin effect) and BOTH `plugins.tab` registrations
 * (MCP then Skills, after the page's own tabs).
 *
 * @param ctx - browser plugin context.
 * @param overrides - test seam ONLY: swap the controller's transport deps
 *   (same-origin fetches by default). Production callers never pass it.
 */
export function apply(ctx: ClientContext, overrides: Partial<ToolscontrolControllerDeps> = {}): void {
  const t = ctx.locale.bind(NS)

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'toolscontrol: dictionaries')
  ctx.effect(() => installStyles(), 'toolscontrol: styles')

  const controller = new ToolscontrolController({
    fetchOverview,
    probe: probeServer,
    ...(listStoreOf(ctx, 'sessions') !== undefined
      ? { sessions: listStoreOf(ctx, 'sessions') as unknown as ObservableStore<SessionsListShape> }
      : {}),
    ...(listStoreOf(ctx, 'workspaces') !== undefined
      ? { workspaces: listStoreOf(ctx, 'workspaces') as unknown as ObservableStore<WorkspacesListShape> }
      : {}),
    ...overrides,
  })
  ctx.effect(
    () => () => {
      controller.dispose()
    },
    'toolscontrol: controller lifecycle',
  )

  // Language changes re-sort rows (Intl.Collator follows the active locale).
  ctx.effect(() => {
    const sync = () => {
      const active = ctx.locale.getSnapshot().active
      if (typeof active === 'string' && active !== '') controller.setLanguage(active)
    }
    sync()
    return ctx.locale.subscribe(sync)
  }, 'toolscontrol: language sync')

  // Official invalidation event (the same one the shipped Plugins page uses).
  ctx.effect(() => {
    const remote = ctx.remote
    if (remote === undefined || typeof remote.$on !== 'function') return
    return remote.$on('plugin-manager/changed', () => {
      controller.invalidate()
    })
  }, 'toolscontrol: plugin-manager invalidations')

  // Future mcpManager watch (rc.5: absent — this is a no-op there).
  ctx.effect(() => attachMcpWatch(controller, ctx.remote), 'toolscontrol: mcpManager watch')

  const face = () => ({ tc: controller, t })
  ctx.slots.inject('plugins.tab', () =>
    ctx.slots.register(
      { name: 'plugins.tab', id: 'mcp', label: () => t('tab.mcp'), locale: NS, order: 100, inject: face },
      McpSection,
    ),
  )
  ctx.slots.inject('plugins.tab', () =>
    ctx.slots.register(
      { name: 'plugins.tab', id: 'skills', label: () => t('tab.skills'), locale: NS, order: 110, inject: face },
      SkillsSection,
    ),
  )
}
