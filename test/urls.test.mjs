import test from "node:test";
import assert from "node:assert/strict";
import { buildCodeServerUrl, deriveCodeServerBase, withGateTicket } from "../src/shared/urls.ts";

test("derives the sibling code-server host from the public Paperclip host", () => {
  assert.equal(
    deriveCodeServerBase({
      protocol: "https:",
      hostname: "paperclip-19099.example.com",
      port: "18443",
    }),
    "https://paperclip-19081.example.com:18443",
  );
});

test("derives the local code-server port for loopback UI", () => {
  assert.equal(
    deriveCodeServerBase({ protocol: "http:", hostname: "127.0.0.1", port: "19099" }),
    "http://127.0.0.1:19081",
  );
  assert.equal(
    deriveCodeServerBase({ protocol: "http:", hostname: "localhost", port: "19099" }),
    "http://localhost:19081",
  );
});

test("does not rewrite an unrelated 19099 substring", () => {
  assert.equal(
    deriveCodeServerBase({
      protocol: "https:",
      hostname: "paperclip.example.com",
      port: "19099",
    }),
    "https://paperclip.example.com:19099",
  );
});

test("builds a folder deep link and tolerates a trailing slash", () => {
  assert.equal(
    buildCodeServerUrl("https://host:18443/", "/home/linuxbrew/Projects/qnnp-opc"),
    "https://host:18443/?folder=%2Fhome%2Flinuxbrew%2FProjects%2Fqnnp-opc",
  );
  assert.equal(buildCodeServerUrl("https://host:18443", ""), "https://host:18443/");
});
test("withGateTicket appends cs_t before the fragment and keeps folder", () => {
  const url = "https://paperclip-19081.example.com:18443/?folder=%2Fhome%2Flinuxbrew%2FProjects%2Fqnnp-opc";
  assert.equal(
    withGateTicket(url, "v1.1.abc"),
    `${url}&cs_t=v1.1.abc`,
  );
  assert.equal(withGateTicket("https://x/", "v1.1.abc"), "https://x/?cs_t=v1.1.abc");
  assert.equal(withGateTicket("https://x/#frag", "v1.1.abc"), "https://x/?cs_t=v1.1.abc#frag");
  assert.equal(withGateTicket(url, null), url);
});
