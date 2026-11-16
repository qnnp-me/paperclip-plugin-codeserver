/**
 * Render smoke test for the built UI bundle.
 *
 * Loads `dist/ui/index.js` exactly as the host will (ES module, bare `react`
 * and `@paperclipai/plugin-sdk/ui` imports) and renders the slot exports to
 * static markup. Bridge hooks are stubbed through the same global registry the
 * host installs at runtime.
 */
import test from "node:test";
import assert from "node:assert/strict";

// The page component reads window.location / localStorage during render.
const store = new Map();
globalThis.window = {
  location: {
    protocol: "https:",
    hostname: "paperclip-19099.example.com",
    port: "18443",
  },
  localStorage: {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value),
  },
};

const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");

/** Stub host context + data handler results, as the host bridge would. */
let dataResult = {
  data: {
    path: "/home/linuxbrew/Projects/qnnp-opc",
    source: "issue_workspace",
    name: "qnnp-opc",
    entityType: "issue",
  },
  loading: false,
  error: null,
  refresh() {},
};
let hostContext = {
  companyId: "company-1",
  companyPrefix: "CMP",
  projectId: "project-1",
  entityId: "issue-1",
  entityType: "issue",
  parentEntityId: null,
  userId: "user-1",
  renderEnvironment: null,
};

globalThis.__paperclipPluginBridge__ = {
  react: { createElement },
  sdkUi: {
    usePluginData: () => dataResult,
    useHostContext: () => hostContext,
  },
};

const ui = await import("../dist/ui/index.js");

const context = { companyId: "company-1", companyPrefix: "CMP" };
const slot = { pluginId: "qnnp.codeserver", displayName: "Code Server" };

test("CodeServerPage renders an iframe pointed at the sibling code-server host", () => {
  const html = renderToStaticMarkup(createElement(ui.CodeServerPage, { slot, context }));
  assert.match(html, /<iframe/);
  assert.match(
    html,
    /src="https:\/\/paperclip-19081\.example\.com:18443\/\?folder=%2Fhome%2Flinuxbrew%2FProjects%2Fqnnp-opc"/,
  );
});

test("CodeServerToolbarButton links to the company-scoped plugin page", () => {
  const html = renderToStaticMarkup(createElement(ui.CodeServerToolbarButton, { slot, context }));
  assert.match(html, /href="\/CMP\/plugins\/qnnp\.codeserver"/);
  assert.match(html, />Code</);
});

test("CodeServerContextTab opens the workspace resolved for the task", () => {
  const html = renderToStaticMarkup(createElement(ui.CodeServerContextTab, { slot, context }));
  assert.match(
    html,
    /src="https:\/\/paperclip-19081\.example\.com:18443\/\?folder=%2Fhome%2Flinuxbrew%2FProjects%2Fqnnp-opc"/,
  );
  assert.match(html, /任务工作区/);
  assert.match(html, /qnnp-opc/);
});

test("CodeServerContextTab surfaces resolution errors instead of guessing a folder", () => {
  dataResult = { data: null, loading: false, error: { code: "UNKNOWN", message: "这个任务还没有可用的工作区目录" }, refresh() {} };
  try {
    const html = renderToStaticMarkup(createElement(ui.CodeServerContextTab, { slot, context }));
    assert.doesNotMatch(html, /<iframe/);
    assert.match(html, /这个任务还没有可用的工作区目录/);
    assert.match(html, /用这个目录/);
  } finally {
    dataResult = {
      data: {
        path: "/home/linuxbrew/Projects/qnnp-opc",
        source: "issue_workspace",
        name: "qnnp-opc",
        entityType: "issue",
      },
      loading: false,
      error: null,
      refresh() {},
    };
  }
});

test("CodeServerContextTab uses the project primary workspace on project pages", () => {
  hostContext = { ...hostContext, entityId: "project-1", entityType: "project" };
  dataResult = {
    data: {
      path: "/home/linuxbrew/Projects/qnnp-opc",
      source: "project_workspace",
      name: "qnnp-opc",
      entityType: "project",
    },
    loading: false,
    error: null,
    refresh() {},
  };
  try {
    const html = renderToStaticMarkup(createElement(ui.CodeServerContextTab, { slot, context }));
    assert.match(html, /项目主工作区/);
    assert.match(html, /folder=%2Fhome%2Flinuxbrew%2FProjects%2Fqnnp-opc/);
  } finally {
    hostContext = { ...hostContext, entityId: "issue-1", entityType: "issue" };
  }
});