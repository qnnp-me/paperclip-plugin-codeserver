import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  validateSettings,
} from "../src/config.ts";

test("empty config falls back to the built-in deployment defaults", () => {
  assert.deepEqual(normalizeSettings(undefined), DEFAULT_SETTINGS);
  assert.deepEqual(normalizeSettings(null), DEFAULT_SETTINGS);
  assert.deepEqual(normalizeSettings({}), DEFAULT_SETTINGS);
});

test("operator config overrides each environment value", () => {
  const settings = normalizeSettings({
    codeServerBaseUrl: "https://code.example.com/",
    codeServerPort: "19443",
    paperclipPort: 19500,
    pageFolder: " /srv/workspaces ",
    gateSecretFile: "/srv/secrets/cs-gate.secret",
    gateTicketTtlSeconds: "600",
  });
  assert.deepEqual(settings, {
    codeServerBaseUrl: "https://code.example.com",
    codeServerPort: 19443,
    paperclipPort: 19500,
    pageFolder: "/srv/workspaces",
    gateSecretFile: "/srv/secrets/cs-gate.secret",
    gateTicketTtlSeconds: 600,
  });
});

test("invalid values fall back instead of breaking the editor", () => {
  const settings = normalizeSettings({
    codeServerPort: "not-a-port",
    paperclipPort: 70000,
    gateTicketTtlSeconds: 5,
    pageFolder: "   ",
  });
  assert.equal(settings.codeServerPort, DEFAULT_SETTINGS.codeServerPort);
  assert.equal(settings.paperclipPort, DEFAULT_SETTINGS.paperclipPort);
  assert.equal(settings.gateTicketTtlSeconds, DEFAULT_SETTINGS.gateTicketTtlSeconds);
  assert.equal(settings.pageFolder, DEFAULT_SETTINGS.pageFolder);
});

test("validateSettings accepts an empty config and valid overrides", () => {
  assert.deepEqual(validateSettings({}), { ok: true, errors: [] });
  assert.deepEqual(
    validateSettings({
      codeServerBaseUrl: "https://code.example.com/",
      codeServerPort: 19081,
      paperclipPort: 19099,
      pageFolder: "/home/linuxbrew/Projects",
      gateSecretFile: "/home/linuxbrew/.startup/code-server-gate.secret",
      gateTicketTtlSeconds: 300,
    }),
    { ok: true, errors: [] },
  );
  assert.equal(validateSettings({ codeServerBaseUrl: "" }).ok, true);
  assert.equal(validateSettings({ codeServerBaseUrl: "https://code.example.com/" }).ok, true);
});

test("validateSettings reports operator-readable errors", () => {
  const result = validateSettings({
    codeServerBaseUrl: "code.example.com",
    pageFolder: "Projects",
    gateSecretFile: "relative.secret",
    codeServerPort: 0,
    paperclipPort: 70000,
    gateTicketTtlSeconds: 5,
  });
  assert.equal(result.ok, false);
  assert.equal(result.errors.length, 6);
  assert.ok(result.errors.some((message) => message.includes("codeServerBaseUrl")));
  assert.ok(result.errors.some((message) => message.includes("pageFolder")));
  assert.ok(result.errors.some((message) => message.includes("gateSecretFile")));
  assert.ok(result.errors.some((message) => message.includes("codeServerPort")));
  assert.ok(result.errors.some((message) => message.includes("paperclipPort")));
  assert.ok(result.errors.some((message) => message.includes("gateTicketTtlSeconds")));
});