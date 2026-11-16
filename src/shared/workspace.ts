/**
 * Pure workspace-resolution helpers (no host imports, no React).
 *
 * The host gives a plugin context only ids (`entityType` + `entityId`). The
 * plugin worker turns those ids into a filesystem folder:
 *   issue   → its execution workspace `cwd`, else its project's workspace
 *   project → the project's primary workspace
 * These functions hold the decision logic so it can be unit-tested.
 */

export type Nullable = string | null | undefined;

/** Absolute paths only; trailing slashes trimmed; `"/"` preserved. */
export function normalizeFolderPath(value: Nullable): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || !trimmed.startsWith("/")) return null;
  const withoutTrailing = trimmed.length > 1 ? trimmed.replace(/\/+$/, "") : trimmed;
  return withoutTrailing.length > 0 ? withoutTrailing : "/";
}

export type TargetSource = "issue_workspace" | "project_workspace";

export type ResolvedTarget = {
  path: string;
  source: TargetSource;
};

export type TargetCandidates = {
  /** `ctx.executionWorkspaces.get(issue.executionWorkspaceId)` */
  executionWorkspace?: { cwd?: Nullable; path?: Nullable } | null;
  /** `ctx.projects.getWorkspaceForIssue(...)` / `getPrimaryWorkspace(...)` */
  projectWorkspace?: { path?: Nullable } | null;
};

/**
 * Execution workspace wins when it is locally realized (isolated per-issue
 * checkouts), otherwise fall back to the project's primary workspace.
 */
export function pickTarget(candidates: TargetCandidates): ResolvedTarget | null {
  const execution =
    normalizeFolderPath(candidates.executionWorkspace?.cwd) ??
    normalizeFolderPath(candidates.executionWorkspace?.path);
  if (execution) return { path: execution, source: "issue_workspace" };

  const project = normalizeFolderPath(candidates.projectWorkspace?.path);
  if (project) return { path: project, source: "project_workspace" };

  return null;
}

/** Human-readable label for the source chip in the tab. */
export function describeSource(source: TargetSource): string {
  return source === "issue_workspace" ? "任务工作区" : "项目主工作区";
}