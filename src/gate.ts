/**
 * Gate tickets for the cs-gate autologin proxy (worker side only).
 *
 * The proxy (`/home/linuxbrew/.local/opt/cs-gate/proxy.mjs`) validates
 *   v1.<unix-exp-seconds>.<HMAC-SHA256(secret,"v1.<exp>")[:32] base64url>
 * with the same secret, so the plugin never hands code-server's password to
 * the browser: it only mints a 5-minute ticket, and the proxy trades it for a
 * 12-hour `cs_gate` cookie server-side.
 *
 * The secret is a 600 file shared with the proxy. Set
 * `CODESERVER_GATE_SECRET_FILE` to point somewhere else (tests do).
 */
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

export const DEFAULT_SECRET_FILE = "/home/linuxbrew/.startup/code-server-gate.secret";
export const DEFAULT_TICKET_TTL = 300;

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

/**
 * Best effort: a missing/unreadable secret must never break the editor — the
 * caller falls back to the plain URL (code-server shows its login page).
 */
export function issueGateTicket(ttlSeconds = DEFAULT_TICKET_TTL, nowMs = Date.now()): GateTicket | null {
  try {
    return signGateTicket(readGateSecret(), ttlSeconds, nowMs);
  } catch {
    return null;
  }
}