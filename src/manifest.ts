/**
 * Manifest for the code-server embedding plugin.
 *
 * Contract notes (Paperclip 2026.1106.0):
 * - `entrypoints.ui` must be a directory; the host always serves `index.js` from it.
 * - `entrypoints.worker` is mandatory even for a UI-only plugin.
 * - `page` slots need `ui.page.register`; action buttons need `ui.action.register`;
 *   detail tabs need `ui.detailTab.register`.
 * - `detailTab` slots must list the entity types they mount on. The task page
 *   hides its tab strip in the default chat-shell UI, so the host side panel
 *   reuses this slot; the top-bar button remains the primary entry point.
 * - Workspace lookup (`ctx.projects`, `ctx.executionWorkspaces`) needs the
 *   matching read capabilities; the host audits them per install.
 * - `instanceConfigSchema` is rendered by the host as a company-scoped settings
 *   form at `/settings/plugins/qnnp.codeserver`; the worker reads the same
 *   values via `ctx.config.get(companyId)` (see `src/config.ts`).
 *
 * Deployment values (code-server URL/ports, default folder, cs-gate secret file,
 * ticket TTL) are configuration, not code: change them in the settings form or
 * with `paperclipai plugin config:set`, no rebuild required.
 */
const manifest = {
  id: "qnnp.codeserver",
  apiVersion: 1,
  version: "0.6.1",
  displayName: "Code Server",
  description:
    "Embeds code-server inside Paperclip: one top-bar Code button that opens the current task/project workspace full-screen, plus a chrome-free Code tab in the task side panel.",
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
  instanceConfigSchema: {
    type: "object",
    properties: {
      codeServerBaseUrl: {
        type: "string",
        title: "code-server 地址",
        description:
          "code-server 的完整公开地址，例如 https://code.example.com/。留空则按当前页面推导（把 Paperclip 端口换为 code-server 端口，或本地回环用 codeServerPort）。",
        default: "",
      },
      codeServerPort: {
        type: "integer",
        title: "code-server 端口",
        description: "推导地址时使用的 code-server 端口。",
        default: 19081,
        minimum: 1,
        maximum: 65535,
      },
      paperclipPort: {
        type: "integer",
        title: "Paperclip 端口",
        description: "推导同主机地址时，从页面 host 里替换掉的端口。",
        default: 19099,
        minimum: 1,
        maximum: 65535,
      },
      pageFolder: {
        type: "string",
        title: "插件页默认目录",
        description: "直接打开插件页（…/plugins/<实例 UUID>）时显示的绝对路径。",
        default: "/home/linuxbrew/Projects",
        minLength: 1,
      },
      gateSecretFile: {
        type: "string",
        title: "自动登录共享秘密文件",
        description:
          "与 cs-gate 代理共用的 600 文件（绝对路径）。读不到时插件退回普通登录页，不报错。",
        default: "/home/linuxbrew/.startup/code-server-gate.secret",
        minLength: 1,
      },
      gateTicketTtlSeconds: {
        type: "integer",
        title: "自动登录票据有效期（秒）",
        description: "代理用它换发会话 cookie；默认 300 秒（5 分钟）。",
        default: 300,
        minimum: 30,
        maximum: 3600,
      },
    },
  },
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
        entityTypes: ["issue"],
        order: 30,
      },
    ],
  },
} as const;

export default manifest;