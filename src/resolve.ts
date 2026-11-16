/**
 * Worker-side workspace resolution (no SDK import, no side effects).
 *
 * Separated from `worker.ts` so it can be unit-tested directly: importing the
 * worker module boots `runWorker()`.
 */
import {
  pickTarget,
  type Nullable,
  type ResolvedTarget,
} from "./shared/workspace.ts";

export type WorkspaceRequest = {
  companyId?: unknown;
  entityId?: unknown;
  entityType?: unknown;
};

/** Narrow dependency surface so the resolver can be tested with fakes. */
export type ResolverDeps = {
  issues: {
    get(
      issueId: string,
      companyId: string,
    ): Promise<{ executionWorkspaceId?: string | null } | null>;
  };
  executionWorkspaces: {
    get(
      workspaceId: string,
      companyId: string,
    ): Promise<{ cwd?: Nullable; path?: Nullable } | null>;
  };
  projects: {
    getWorkspaceForIssue(
      issueId: string,
      companyId: string,
    ): Promise<{ path?: Nullable } | null>;
    getPrimaryWorkspace(
      projectId: string,
      companyId: string,
    ): Promise<{ path?: Nullable } | null>;
  };
};

export type WorkspaceResult = ResolvedTarget & {
  name: string | null;
  entityType: "issue" | "project";
};

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function lastPathSegment(path: string): string {
  const segments = path.replace(/\/+$/, "").split("/").filter(Boolean);
  return segments[segments.length - 1] ?? path;
}

/**
 * Resolve the folder for a detail tab.
 *
 * Order: issue execution workspace → the issue's project workspace →
 * project primary workspace. Throws with an operator-readable message when
 * the entity has no locally realized workspace.
 */
export async function resolveWorkspace(
  deps: ResolverDeps,
  request: WorkspaceRequest,
): Promise<WorkspaceResult> {
  const companyId = readString(request.companyId);
  const entityId = readString(request.entityId);
  const entityType = readString(request.entityType);

  if (!companyId) throw new Error("缺少 companyId，无法解析工作区");
  if (!entityId) throw new Error("缺少 entityId，无法解析工作区");
  if (entityType !== "issue" && entityType !== "project") {
    throw new Error(`不支持的对象类型：${entityType ?? "（空）"}`);
  }

  if (entityType === "project") {
    const projectWorkspace = await deps.projects.getPrimaryWorkspace(entityId, companyId);
    const target = pickTarget({ projectWorkspace });
    if (!target) throw new Error("这个项目还没有配置本地工作区目录");
    return {
      ...target,
      name: lastPathSegment(target.path),
      entityType,
    };
  }

  const issue = await deps.issues.get(entityId, companyId);
  if (!issue) throw new Error("找不到这个任务");

  let executionWorkspace: { cwd?: Nullable; path?: Nullable } | null = null;
  if (issue.executionWorkspaceId) {
    executionWorkspace = await deps.executionWorkspaces.get(
      issue.executionWorkspaceId,
      companyId,
    );
  }
  const projectWorkspace = await deps.projects.getWorkspaceForIssue(entityId, companyId);

  const target = pickTarget({ executionWorkspace, projectWorkspace });
  if (!target) throw new Error("这个任务还没有可用的工作区目录");

  return {
    ...target,
    name: lastPathSegment(target.path),
    entityType,
  };
}