import test from "node:test";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { signGateTicket, issueGateTicket } from "../src/gate.ts";

/** Mirrors the cs-gate proxy's verifier (v1.<exp>.<mac[:32]>). */
function proxyVerifies(token, secret, nowMs) {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return false;
  const exp = Number(parts[1]);
  if (!Number.isFinite(exp) || exp * 1000 < nowMs) return false;
  const expected = createHmac("sha256", secret).update(`v1.${parts[1]}`).digest("base64url").slice(0, 32);
  return parts[2] === expected;
}

test("ticket is signed the way the cs-gate proxy verifies it", () => {
  const secret = "a".repeat(40);
  const now = 1_700_000_000_000;
  const ticket = signGateTicket(secret, 300, now);
  assert.equal(ticket.ttl, 300);
  assert.equal(ticket.exp, Math.floor(now / 1000) + 300);
  assert.match(ticket.token, /^v1\.\d+\.[A-Za-z0-9_-]{32}$/);
  assert.equal(proxyVerifies(ticket.token, secret, now), true);
});

test("expired ticket and wrong secret are rejected", () => {
  const now = 1_700_000_000_000;
  const ticket = signGateTicket("b".repeat(40), 60, now);
  assert.equal(proxyVerifies(ticket.token, "b".repeat(40), now + 61_000), false);
  assert.equal(proxyVerifies(ticket.token, "c".repeat(40), now), false);
  assert.equal(proxyVerifies("v1.9999999999.forged", "b".repeat(40), now), false);
});

test("a missing secret degrades to null instead of throwing", () => {
  const previous = process.env.CODESERVER_GATE_SECRET_FILE;
  process.env.CODESERVER_GATE_SECRET_FILE = "/nonexistent/cs-gate.secret";
  try {
    assert.equal(issueGateTicket(), null);
  } finally {
    if (previous === undefined) delete process.env.CODESERVER_GATE_SECRET_FILE;
    else process.env.CODESERVER_GATE_SECRET_FILE = previous;
  }
});

test("readGateSecret refuses a too-short secret file", () => {
  const fs = require("node:fs");
  const file = "/tmp/cs-gate-short.secret";
  fs.writeFileSync(file, "short\n", { mode: 0o600 });
  const previous = process.env.CODESERVER_GATE_SECRET_FILE;
  process.env.CODESERVER_GATE_SECRET_FILE = file;
  try {
    // short secret → issueGateTicket swallows it and the UI falls back to the login page
    assert.equal(issueGateTicket(), null);
  } finally {
    if (previous === undefined) delete process.env.CODESERVER_GATE_SECRET_FILE;
    else process.env.CODESERVER_GATE_SECRET_FILE = previous;
  }
});

test("ticket TTL and secret file come from options (plugin config)", () => {
  const fs = require("node:fs");
  const file = "/tmp/cs-gate-config.secret";
  const secret = "d".repeat(40);
  fs.writeFileSync(file, `${secret}\n`, { mode: 0o600 });
  const now = 1_700_000_000_000;
  const ticket = issueGateTicket({ ttlSeconds: 600, secretFile: file, nowMs: now });
  assert.equal(ticket.ttl, 600);
  assert.equal(proxyVerifies(ticket.token, secret, now), true);
});

test("an unreadable configured secret file degrades to null", () => {
  assert.equal(issueGateTicket({ secretFile: "/nonexistent/configured.secret" }), null);
});
