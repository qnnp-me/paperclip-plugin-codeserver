/**
 * Manifest for the code-server embedding plugin.
 *
 * Contract notes (Paperclip 2026.1106.0):
 * - `entrypoints.ui` must be a directory; the host always serves `index.js` from it.
 * - `entrypoints.worker` is mandatory even for a UI-only plugin.
 * - `page` slots need `ui.page.register`; action buttons need `ui.action.register`;
 *   detail tabs need `ui.detailTab.register`.
 * - `detailTab` and `toolbarButton` slots must list the entity types they
 *   mount on. The task page hides its tab strip in the default chat-shell UI,
 *   so the toolbar button is the entry point users actually see.
 * - Workspace lookup (`ctx.projects`, `ctx.executionWorkspaces`) needs the
 *   matching read capabilities; the host audits them per install.
 */
const manifest = {
  id: "qnnp.codeserver",
  apiVersion: 1,
  version: "0.3.0",
  displayName: "Code Server",
  description:
    "Embeds code-server inside Paperclip: a Code button on every task and project that opens that entity's own workspace folder full-screen, plus a full page and a top-bar entry.",
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
        type: "toolbarButton",
        id: "codeserver-entity-button",
        displayName: "Code",
        exportName: "CodeServerEntityButton",
        entityTypes: ["issue", "project"],
        order: 20,
      },
      {
        type: "detailTab",
        id: "codeserver-detail-tab",
        displayName: "Code",
        exportName: "CodeServerContextTab",
        entityTypes: ["issue", "project"],
        order: 30,
      },
    ],
  },
} as const;

export default manifest;