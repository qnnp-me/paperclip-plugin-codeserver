/**
 * End-to-end worker test on the SDK's in-memory host harness.
 *
 * This is the closest thing to the real bridge: the harness enforces the
 * manifest's capabilities exactly like the host does, then routes
 * `getData("workspace")` through the real plugin definition.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import manifest from "../src/manifest.ts";
import { pluginDefinition } from "../src/plugin.ts";

const COMPANY_ID = "company-1";
const PROJECT_ID = "project-1";

function seed(harness) {
  harness.seed({
    companies: [{ id: COMPANY_ID, name: "Test Co" }],
    projects: [
      {
        id: PROJECT_ID,
        companyId: COMPANY_ID,
        name: "OPC",
        status: "planned",
        executionWorkspacePolicy: null,
        archivedAt: null,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-01T00:00:00Z"),
      },
    ],
    projectWorkspaces: [
      {
        id: "workspace-1",
        projectId: PROJECT_ID,
        name: "qnnp-opc",
        path: "/home/linuxbrew/Projects/qnnp-opc",
        repoUrl: null,
        repoRef: null,
        defaultRef: null,
        isPrimary: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    executionWorkspaces: [
      {
        id: "exec-1",
        companyId: COMPANY_ID,
        projectId: PROJECT_ID,
        projectWorkspaceId: "workspace-1",
        path: "/home/linuxbrew/Projects/qnnp-opc",
        cwd: "/home/linuxbrew/Projects/qnnp-opc",
        repoUrl: null,
        baseRef: null,
        branchName: null,
        providerType: "local_fs",
        providerMetadata: null,
      },
    ],
    issues: [
      {
        id: "issue-1",
        companyId: COMPANY_ID,
        projectId: PROJECT_ID,
        title: "CMP-29",
        status: "in_progress",
        executionWorkspaceId: "exec-1",
      },
      {
        id: "issue-2",
        companyId: COMPANY_ID,
        projectId: PROJECT_ID,
        title: "no execution workspace",
        status: "todo",
        executionWorkspaceId: null,
      },
    ],
  });
}

async function booted(capabilities) {
  const harness = createTestHarness({ manifest, capabilities });
  seed(harness);
  await pluginDefinition.definition.setup(harness.ctx);
  return harness;
}

test("task tab data resolves the workspace through the real capability gates", async () => {
  const harness = await booted();
  const result = await harness.getData("workspace", {
    companyId: COMPANY_ID,
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

test("project tab data resolves the primary workspace", async () => {
  const harness = await booted();
  const result = await harness.getData("workspace", {
    companyId: COMPANY_ID,
    entityId: PROJECT_ID,
    entityType: "project",
  });
  assert.equal(result.path, "/home/linuxbrew/Projects/qnnp-opc");
  assert.equal(result.source, "project_workspace");
});

test("issue without an execution workspace falls back to the project workspace", async () => {
  const harness = await booted();
  const result = await harness.getData("workspace", {
    companyId: COMPANY_ID,
    entityId: "issue-2",
    entityType: "issue",
  });
  assert.equal(result.source, "project_workspace");
  assert.equal(result.path, "/home/linuxbrew/Projects/qnnp-opc");
});

test("capability gate: without issues.read the task lookup is rejected", async () => {
  const harness = createTestHarness({
    manifest,
    capabilities: manifest.capabilities.filter((cap) => cap !== "issues.read"),
  });
  seed(harness);
  await pluginDefinition.definition.setup(harness.ctx);
  await assert.rejects(
    () =>
      harness.getData("workspace", {
        companyId: COMPANY_ID,
        entityId: "issue-1",
        entityType: "issue",
      }),
    /issues\.read/,
  );
});

test("capability gate: without project.workspaces.read the project lookup is rejected", async () => {
  const harness = createTestHarness({
    manifest,
    capabilities: manifest.capabilities.filter((cap) => cap !== "project.workspaces.read"),
  });
  seed(harness);
  await pluginDefinition.definition.setup(harness.ctx);
  await assert.rejects(
    () =>
      harness.getData("workspace", {
        companyId: COMPANY_ID,
        entityId: PROJECT_ID,
        entityType: "project",
      }),
    /project\.workspaces\.read/,
  );
});

test("missing company scope is rejected before touching host data", async () => {
  const harness = await booted();
  await assert.rejects(
    () => harness.getData("workspace", { entityId: "issue-1", entityType: "issue" }),
    /缺少 companyId/,
  );
});