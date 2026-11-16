/**
 * Manifest for the code-server embedding plugin.
 *
 * Contract notes (Paperclip 2026.1106.0):
 * - `entrypoints.ui` must be a directory; the host always serves `index.js` from it.
 * - `entrypoints.worker` is mandatory even for a UI-only plugin.
 * - `page` slots need `ui.page.register`; `globalToolbarButton` needs `ui.action.register`.
 */
const manifest = {
  id: "qnnp.codeserver",
  apiVersion: 1,
  version: "0.1.0",
  displayName: "Code Server",
  description:
    "Embeds code-server inside Paperclip: one page slot with the editor and a top-bar entry button.",
  author: "熊小兮",
  categories: ["workspace"],
  capabilities: ["ui.page.register", "ui.action.register"],
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
    ],
  },
} as const;

export default manifest;