/**
 * Gate tickets for the cs-gate autologin proxy (worker side only).
 *
 * The proxy (`/home/linuxbrew/.local/opt/cs-gate/proxy.mjs`) validates
 *   v1.<unix-exp-seconds>.<HMAC-SHA256(secret,"v1.<exp>")[:32] base64url>
 * with the same secret, so the plugin never hands code-server's password to
 * the browser: it only mints a 5-minute ticket, and the proxy trades it for a
 * 12-hour `cs_gate` cookie server-side.
 *
 * The secret is a 600 file shared with the proxy. Its path comes from plugin
 * config (`gateSecretFile`); `CODESERVER_GATE_SECRET_FILE` overrides it for
 * local development and tests.
 */
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { DEFAULT_SETTINGS } from "./config.ts";

/** Built-in defaults mirror the operator config defaults (`src/config.ts`). */
export const DEFAULT_SECRET_FILE = DEFAULT_SETTINGS.gateSecretFile;
export const DEFAULT_TICKET_TTL = DEFAULT_SETTINGS.gateTicketTtlSeconds;

export type GateTicket = {
  token: string;
  /** unix seconds */
  exp: number;
  /** seconds of validity handed out */
  ttl: number;
};

export function readGateSecret(file = process.env.CODESERVER_GATE_SECRET_FILE ?? DEFAULT_SECRET_FILE): string {
  const secret = readFileSync(file, "utf8").trim();
  if (secret.length < 32) throw new Error(`gate secret too short: ${file}`);
  return secret;
}

export function signGateTicket(
  secret: string,
  ttlSeconds = DEFAULT_TICKET_TTL,
  nowMs = Date.now(),
): GateTicket {
  const ttl = Math.max(1, Math.floor(ttlSeconds));
  const exp = Math.floor(nowMs / 1000) + ttl;
  const mac = createHmac("sha256", secret).update(`v1.${exp}`).digest("base64url").slice(0, 32);
  return { token: `v1.${exp}.${mac}`, exp, ttl };
}

export type GateTicketOptions = {
  /** Ticket lifetime; comes from plugin config (`gateTicketTtlSeconds`). */
  ttlSeconds?: number;
  /** Shared secret file; comes from plugin config (`gateSecretFile`). */
  secretFile?: string;
  /** Injectable clock for tests. */
  nowMs?: number;
};

/**
 * Best effort: a missing/unreadable secret must never break the editor — the
 * caller falls back to the plain URL (code-server shows its login page).
 *
 * Precedence for the secret file: explicit option (plugin config) → env
 * override (local development) → built-in default.
 */
export function issueGateTicket(options: GateTicketOptions = {}): GateTicket | null {
  const file = options.secretFile ?? process.env.CODESERVER_GATE_SECRET_FILE ?? DEFAULT_SECRET_FILE;
  try {
    return signGateTicket(
      readGateSecret(file),
      options.ttlSeconds ?? DEFAULT_TICKET_TTL,
      options.nowMs ?? Date.now(),
    );
  } catch {
    return null;
  }
}