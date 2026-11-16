import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeFolderPath,
  pickTarget,
  describeSource,
} from "../src/shared/workspace.ts";
import { resolveWorkspace } from "../src/resolve.ts";

test("normalizeFolderPath keeps absolute paths, trims trailing slashes", () => {
  assert.equal(normalizeFolderPath("  /home/linuxbrew/Projects/qnnp-opc/  "), "/home/linuxbrew/Projects/qnnp-opc");
  assert.equal(normalizeFolderPath("/"), "/");
  assert.equal(normalizeFolderPath("/home/linuxbrew"), "/home/linuxbrew");
  assert.equal(normalizeFolderPath("relative/path"), null);
  assert.equal(normalizeFolderPath(""), null);
  assert.equal(normalizeFolderPath(null), null);
  assert.equal(normalizeFolderPath(undefined), null);
});

test("pickTarget prefers the issue execution workspace, then the project workspace", () => {
  assert.deepEqual(
    pickTarget({
      executionWorkspace: { cwd: "/w/issue-a", path: "/w/issue-a" },
      projectWorkspace: { path: "/w/project" },
    }),
    { path: "/w/issue-a", source: "issue_workspace" },
  );
  // Execution workspace exists but has no local cwd → fall back.
  assert.deepEqual(
    pickTarget({
      executionWorkspace: { cwd: null, path: null },
      projectWorkspace: { path: "/w/project" },
    }),
    { path: "/w/project", source: "project_workspace" },
  );
  assert.equal(pickTarget({}), null);
  assert.equal(describeSource("issue_workspace"), "任务工作区");
  assert.equal(describeSource("project_workspace"), "项目主工作区");
});

function fakeDeps(overrides = {}) {
  const calls = [];
  const deps = {
    issues: {
      async get(issueId, companyId) {
        calls.push({ method: "issues.get", args: [issueId, companyId] });
        return "issue" in overrides ? overrides.issue : { executionWorkspaceId: "exec-1" };
      },
    },
    executionWorkspaces: {
      async get(workspaceId, companyId) {
        calls.push({ method: "executionWorkspaces.get", args: [workspaceId, companyId] });
        return "execution" in overrides
          ? overrides.execution
          : { cwd: "/home/linuxbrew/Projects/qnnp-opc", path: null };
      },
    },
    projects: {
      async getWorkspaceForIssue(issueId, companyId) {
        calls.push({ method: "projects.getWorkspaceForIssue", args: [issueId, companyId] });
        return "projectForIssue" in overrides
          ? overrides.projectForIssue
          : { path: "/home/linuxbrew/Projects/fallback" };
      },
      async getPrimaryWorkspace(projectId, companyId) {
        calls.push({ method: "projects.getPrimaryWorkspace", args: [projectId, companyId] });
        return "primary" in overrides
          ? overrides.primary
          : { path: "/home/linuxbrew/Projects/qnnp-opc" };
      },
    },
  };
  return { deps, calls };
}

test("issue tab resolves the execution workspace cwd", async () => {
  const { deps } = fakeDeps();
  const result = await resolveWorkspace(deps, {
    companyId: "company-1",
    entityId: "issue-1",
    entityType: "issue",
  });
  assert.deepEqual(result, {
    path: "/home/linuxbrew/Projects/qnnp-opc",
    source: "issue_workspace",
    name: "qnnp-opc",
    entityType: "issue",
  });
});

test("issue tab falls back to the project workspace when the execution workspace is not local", async () => {
  const { deps } = fakeDeps({ execution: { cwd: null, path: null } });
  const result = await resolveWorkspace(deps, {
    companyId: "company-1",
    entityId: "issue-1",
    entityType: "issue",
  });
  assert.equal(result.path, "/home/linuxbrew/Projects/fallback");
  assert.equal(result.source, "project_workspace");
});

test("issue without an execution workspace still resolves through its project", async () => {
  const { deps, calls } = fakeDeps({ issue: { executionWorkspaceId: null } });
  const result = await resolveWorkspace(deps, {
    companyId: "company-1",
    entityId: "issue-2",
    entityType: "issue",
  });
  assert.equal(result.path, "/home/linuxbrew/Projects/fallback");
  assert.equal(calls.some((call) => call.method === "executionWorkspaces.get"), false);
});

test("project tab resolves the primary workspace", async () => {
  const { deps, calls } = fakeDeps();
  const result = await resolveWorkspace(deps, {
    companyId: "company-1",
    entityId: "project-1",
    entityType: "project",
  });
  assert.deepEqual(result, {
    path: "/home/linuxbrew/Projects/qnnp-opc",
    source: "project_workspace",
    name: "qnnp-opc",
    entityType: "project",
  });
  assert.deepEqual(calls.map((call) => call.method), ["projects.getPrimaryWorkspace"]);
});

test("unresolvable entities fail with an operator-readable message", async () => {
  const { deps } = fakeDeps({ primary: null });
  await assert.rejects(
    resolveWorkspace(deps, { companyId: "company-1", entityId: "project-2", entityType: "project" }),
    /还没有配置本地工作区目录/,
  );
  await assert.rejects(
    resolveWorkspace(deps, { companyId: "", entityId: "x", entityType: "issue" }),
    /缺少 companyId/,
  );
  await assert.rejects(
    resolveWorkspace(deps, { companyId: "company-1", entityId: "x", entityType: "agent" }),
    /不支持的对象类型/,
  );
  const empty = fakeDeps({ issue: { executionWorkspaceId: null }, projectForIssue: null });
  await assert.rejects(
    resolveWorkspace(empty.deps, { companyId: "company-1", entityId: "issue-3", entityType: "issue" }),
    /还没有可用的工作区目录/,
  );
});