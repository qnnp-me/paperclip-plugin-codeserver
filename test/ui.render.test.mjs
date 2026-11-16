/**
 * Render smoke test for the built UI bundle.
 *
 * Loads `dist/ui/index.js` exactly as the host will (ES module, bare `react`
 * imports) and renders both slot exports to static markup.
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