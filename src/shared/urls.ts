/**
 * Pure URL helpers for the code-server plugin (no React, no DOM globals).
 * Kept separate so they can be unit-tested with plain Node.
 */

export type LocationLike = { protocol: string; hostname: string; port: string };

/**
 * Deployment values that affect the derived URL. Both come from operator
 * config, so moving the UI or code-server to other ports needs no rebuild.
 */
export type PortConfig = {
  /** Explicit base URL; wins over any derivation when non-empty. */
  baseUrl?: string | null;
  /** code-server port (default 19081). */
  codeServerPort?: number | null;
  /** Paperclip UI port to replace in the page host (default 19099). */
  paperclipPort?: number | null;
};

/**
 * code-server normally runs next to the Paperclip UI on the same host family:
 * `paperclip.example.com` (UI) ↔ `code-…` (editor). Derive the sibling host by
 * swapping the configured Paperclip port for the configured code-server port;
 * loopback always uses the code-server port. The settings form can pin an
 * explicit `codeServerBaseUrl` instead.
 */
export function deriveCodeServerBase(loc: LocationLike, config: PortConfig = {}): string {
  const explicit = config.baseUrl?.trim();
  if (explicit) return trimTrailingSlash(explicit);

  const codeServerPort = config.codeServerPort ?? 19081;
  const paperclipPort = config.paperclipPort ?? 19099;
  const { protocol, hostname, port } = loc;
  const portSuffix = port ? `:${port}` : "";

  const marker = new RegExp(`(^|[.-])${paperclipPort}([.-]|$)`);
  if (marker.test(hostname)) {
    return `${protocol}//${hostname.replace(
      new RegExp(`(^|[.-])${paperclipPort}([.-]|$)`, "g"),
      (_match, before: string, after: string) => `${before}${codeServerPort}${after}`,
    )}${portSuffix}`;
  }
  if (hostname === "127.0.0.1" || hostname === "localhost") {
    return `${protocol}//${hostname}:${codeServerPort}`;
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