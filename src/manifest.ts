/**
 * Manifest for the code-server embedding plugin.
 *
 * Contract notes (Paperclip 2026.1106.0):
 * - `entrypoints.ui` must be a directory; the host always serves `index.js` from it.
 * - `entrypoints.worker` is mandatory even for a UI-only plugin.
 * - `page` slots need `ui.page.register`; action buttons need `ui.action.register`;
 *   detail tabs need `ui.detailTab.register`.
 * - `detailTab` slots must list the entity types they mount on.
 * - Workspace lookup (`ctx.projects`, `ctx.executionWorkspaces`) needs the
 *   matching read capabilities; the host audits them per install.
 */
const manifest = {
  id: "qnnp.codeserver",
  apiVersion: 1,
  version: "0.2.0",
  displayName: "Code Server",
  description:
    "Embeds code-server inside Paperclip: a full page, a top-bar entry button, and a Code tab on tasks and projects that opens each entity's own workspace folder.",
  author: "熊小兮",
  categories: ["workspace"],
  capabilities: [
    "ui.page.register",
    "ui.action.register",
    "ui.detailTab.register",
    "issues.read",
    "execution.workspaces.read",
    "project.workspaces.read",
  ],
  entrypoints: {
    worker: "./dist/worker.js",
    ui: "./dist/ui/",
  },
  ui: {
    slots: [
      {
        type: "page",
        id: "codeserver-page",
        displayName: "Code Server",
        exportName: "CodeServerPage",
        order: 10,
      },
      {
        type: "globalToolbarButton",
        id: "codeserver-toolbar",
        displayName: "Code Server",
        exportName: "CodeServerToolbarButton",
        order: 10,
      },
      {
        type: "detailTab",
        id: "codeserver-detail-tab",
        displayName: "Code",
        exportName: "CodeServerContextTab",
        entityTypes: ["issue", "project"],
        order: 20,
      },
    ],
  },
} as const;

export default manifest;