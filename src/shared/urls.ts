/**
 * Pure URL helpers for the code-server plugin (no React, no DOM globals).
 * Kept separate so they can be unit-tested with plain Node.
 */

export type LocationLike = { protocol: string; hostname: string; port: string };

/**
 * code-server runs next to the Paperclip UI on the same host family:
 * `paperclip-19099…` (Paperclip) ↔ `paperclip-19081…` (code-server).
 * Derive the sibling host instead of hardcoding the deployment domain; the
 * page UI also lets the operator override the result.
 */
export function deriveCodeServerBase(loc: LocationLike): string {
  const { protocol, hostname, port } = loc;
  const portSuffix = port ? `:${port}` : "";
  if (/(^|[.-])19099([.-]|$)/.test(hostname)) {
    return `${protocol}//${hostname.replace(
      /(^|[.-])19099([.-]|$)/g,
      (_match, before: string, after: string) => `${before}19081${after}`,
    )}${portSuffix}`;
  }
  if (hostname === "127.0.0.1" || hostname === "localhost") {
    return `${protocol}//${hostname}:19081`;
  }
  return `${protocol}//${hostname}${portSuffix}`;
}

export function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

/** `?folder=` deep link survives code-server's login redirect (verified). */
export function buildCodeServerUrl(baseUrl: string, folder: string): string {
  const base = trimTrailingSlash(baseUrl.trim());
  if (!folder) return `${base}/`;
  return `${base}/?folder=${encodeURIComponent(folder)}`;
}

/**
 * Append a cs-gate ticket. The proxy trades `cs_t` for a `cs_gate` cookie and
 * redirects to the clean URL, so the ticket never stays in the address bar.
 */
export function withGateTicket(url: string, token: string | null | undefined): string {
  if (!token) return url;
  const [head, hash = ""] = url.split("#");
  const separator = head.includes("?") ? "&" : "?";
  const gated = `${head}${separator}cs_t=${encodeURIComponent(token)}`;
  return hash ? `${gated}#${hash}` : gated;
}