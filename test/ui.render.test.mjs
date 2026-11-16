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
    removeItem: (key) => store.delete(key),
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

test("CodeServerPage renders a chrome-free full-bleed editor", () => {
  const html = renderToStaticMarkup(createElement(ui.CodeServerPage, { slot, context }));
  assert.match(html, /<iframe/);
  assert.match(
    html,
    /src="https:\/\/paperclip-19081\.example\.com:18443\/\?folder=%2Fhome%2Flinuxbrew%2FProjects"/,
  );
  assert.doesNotMatch(html, /设置/);
});

test("CodeFrame shows a loader over the blank iframe until it loads", () => {
  const html = renderToStaticMarkup(createElement(ui.CodeServerPage, { slot, context }));
  // The editor is mounted immediately so the download starts, but covered.
  assert.match(html, /<iframe/);
  assert.match(html, /正在加载编辑器/);
  assert.match(html, /首次打开需要下载 VS Code 前端/);
  assert.match(html, /animation:cs-frame-spin/);
  // No escape hatch before the 12s mark (it would be chrome on a fast open).
  assert.doesNotMatch(html, /在新标签里打开/);
});

test("CodeServerToolbarButton is the single top-bar entry for the current entity", () => {
  const html = renderToStaticMarkup(createElement(ui.CodeServerToolbarButton, { slot, context }));
  assert.match(html, /<button/);
  assert.match(html, />Code</);
  assert.doesNotMatch(html, /<iframe/);
  assert.match(html, /title="在 Paperclip 里打开 \/home\/linuxbrew\/Projects\/qnnp-opc"/);
});

test("CodeServerToolbarButton renders nothing outside a task or project page", () => {
  const saved = hostContext;
  hostContext = { ...saved, entityId: null, entityType: null };
  try {
    const html = renderToStaticMarkup(createElement(ui.CodeServerToolbarButton, { slot, context }));
    assert.equal(html, "");
  } finally {
    hostContext = saved;
  }
});

test("CodeServerContextTab is only the editor, filling the tab", () => {
  const html = renderToStaticMarkup(createElement(ui.CodeServerContextTab, { slot, context }));
  assert.match(
    html,
    /src="https:\/\/paperclip-19081\.example\.com:18443\/\?folder=%2Fhome%2Flinuxbrew%2FProjects%2Fqnnp-opc"/,
  );
  assert.doesNotMatch(html, /重新加载/);
  assert.doesNotMatch(html, /改目录/);
  assert.doesNotMatch(html, /任务工作区/);
  assert.match(html, /height:100%/);
});

test("CodeServerContextTab surfaces resolution errors instead of guessing a folder", () => {
  dataResult = { data: null, loading: false, error: { code: "UNKNOWN", message: "这个任务还没有可用的工作区目录" }, refresh() {} };
  try {
    const html = renderToStaticMarkup(createElement(ui.CodeServerContextTab, { slot, context }));
    assert.doesNotMatch(html, /<iframe/);
    assert.match(html, /这个任务还没有可用的工作区目录/);
    assert.doesNotMatch(html, /用这个目录/);
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
