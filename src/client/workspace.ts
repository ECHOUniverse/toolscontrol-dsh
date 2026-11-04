/**
 * Current-workspace resolution over the two official Client list stores.
 *
 * rc.5 has NO single `selectedWorkspaceId` service. The verified facts
 * (0.2.1-rc.5 asar extract):
 * - `sessions.list` snapshot store: `{ ids, byId, phase, projectionsBySession }`
 *   (`@deepseek-ai/dsh-api-session-controller` `ClientSessions.list`); the main
 *   Session is the row with `(retainedBy.mainView ?? 0) > 0` (the official
 *   `dsh-client-ui-workspace` reads exactly that, client.js:89).
 * - The main Session's `summary.cwd` is the project-level discovery context;
 *   `workspaces.list` items carry `sessionIds`, which this module uses to
 *   attribute the main Session to a workspace (`workspaceId`/`title`).
 * - No main Session ⇒ cwd is UNKNOWN: the UI must say so and show global
 *   skills — never guess a default directory.
 *
 * Structural types only: no released package is imported.
 *
 * @module @hanxu131/toolscontrol-dsh/client/workspace
 */

/** One row of `sessions.list` — only the fields this plugin legitimately reads. */
export interface SessionRowShape {
  id: string
  /** 主 Session 的发现上下文；缺失时为 undefined（cwd 未知）。 */
  cwd?: string
  blank?: boolean
  retainedBy?: { readonly mainView?: number; readonly [source: string]: number | undefined }
}

/** Snapshot of the official `sessions.list` store (consumed subset). */
export interface SessionsListShape {
  ids?: readonly string[]
  byId?: { readonly [sessionId: string]: SessionRowShape | undefined }
  phase?: string
}

/** One workspace view of `workspaces.list` (consumed subset). */
export interface WorkspaceItemShape {
  workspaceId: string
  path: string
  title?: string
  sessionIds?: readonly string[]
  createdAt?: string
}

/** Snapshot of the official `workspaces.list` store (consumed subset). */
export interface WorkspacesListShape {
  items?: readonly WorkspaceItemShape[]
  archivedSessionIds?: readonly string[]
  pinnedSessionIds?: readonly string[]
}

/** Resolved current-workspace context driving the overview `?cwd=` fetch. */
export interface WorkspaceContext {
  /** Main (mainView-retained) session id, if any. */
  sessionId: string | null
  /** Project-level discovery context for Skills; null when unknown. */
  cwd: string | null
  /** Workspace whose `sessionIds` account for the main session, if any. */
  workspaceId: string | null
  /** That workspace's display title, if known. */
  workspaceTitle: string | null
}

/** The "no workspace" context: nothing is guessed. */
export const NO_WORKSPACE: WorkspaceContext = {
  sessionId: null,
  cwd: null,
  workspaceId: null,
  workspaceTitle: null,
}

/**
 * Resolve the current workspace context from the two list snapshots.
 * Pure and total: any missing/malformed input resolves to NO_WORKSPACE.
 */
export function resolveWorkspaceContext(
  sessions: SessionsListShape | undefined,
  workspaces: WorkspacesListShape | undefined,
): WorkspaceContext {
  const byId = sessions?.byId
  if (byId === undefined) return NO_WORKSPACE
  let main: SessionRowShape | undefined
  for (const row of Object.values(byId)) {
    if (row === undefined || row === null) continue
    if ((row.retainedBy?.mainView ?? 0) > 0 && typeof row.id === 'string' && row.id !== '') {
      main = row
      break
    }
  }
  if (main === undefined) return NO_WORKSPACE
  const cwd = typeof main.cwd === 'string' && main.cwd !== '' ? main.cwd : null
  let matched: WorkspaceItemShape | undefined
  for (const item of workspaces?.items ?? []) {
    if (item === undefined || item === null) continue
    if (Array.isArray(item.sessionIds) && item.sessionIds.includes(main.id)) {
      matched = item
      break
    }
  }
  return {
    sessionId: main.id,
    cwd,
    workspaceId: matched?.workspaceId ?? null,
    workspaceTitle: typeof matched?.title === 'string' && matched.title !== '' ? matched.title : null,
  }
}
