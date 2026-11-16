/**
 * Operator configuration for the plugin (pure: no Node or React imports).
 *
 * Everything that depends on the deployment lives here instead of being
 * hardcoded in the UI bundle or the worker:
 *   - how the code-server URL is derived (or an explicit public URL)
 *   - the default folder for the bare plugin page
 *   - where the cs-gate shared secret lives and how long tickets last
 *
 * The host renders this schema as a company-scoped settings form
 * (`/settings/plugins/qnnp.codeserver`) from `instanceConfigSchema` in the
 * manifest; the worker reads the same values through `ctx.config.get()`,
 * and this module normalizes both sources with the same defaults.
 */

export type CodeServerSettings = {
  /** Explicit public code-server base URL; empty means "derive from the page". */
  codeServerBaseUrl: string;
  /** Port code-server listens on, used when deriving the sibling host. */
  codeServerPort: number;
  /** Port the Paperclip UI is served on, used when deriving the sibling host. */
  paperclipPort: number;
  /** Folder shown by the bare plugin page (`…/plugins/<instance>`). */
  pageFolder: string;
  /** 600 file shared with the cs-gate autologin proxy. */
  gateSecretFile: string;
  /** Lifetime of the short-lived ticket the proxy trades for a session. */
  gateTicketTtlSeconds: number;
};

export const DEFAULT_SETTINGS: CodeServerSettings = {
  codeServerBaseUrl: "",
  codeServerPort: 19081,
  paperclipPort: 19099,
  pageFolder: "/home/linuxbrew/Projects",
  gateSecretFile: "/home/linuxbrew/.startup/code-server-gate.secret",
  gateTicketTtlSeconds: 300,
};

/** Ticket TTL bounds: long enough to open a tab, short enough to stay a ticket. */
export const MIN_TICKET_TTL_SECONDS = 30;
export const MAX_TICKET_TTL_SECONDS = 3600;

function readString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readInteger(value: unknown, fallback: number, min: number, max: number): number {
  const raw = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : NaN;
  if (!Number.isFinite(raw)) return fallback;
  const integer = Math.floor(raw);
  if (integer < min || integer > max) return fallback;
  return integer;
}

/**
 * Merge operator config over the defaults. Invalid or missing values fall back
 * instead of failing the editor: a bad setting must not blank the tab.
 */
export function normalizeSettings(raw: Record<string, unknown> | null | undefined): CodeServerSettings {
  const input = raw ?? {};
  return {
    codeServerBaseUrl: readString(input.codeServerBaseUrl)?.replace(/\/+$/, "") ?? "",
    codeServerPort: readInteger(input.codeServerPort, DEFAULT_SETTINGS.codeServerPort, 1, 65535),
    paperclipPort: readInteger(input.paperclipPort, DEFAULT_SETTINGS.paperclipPort, 1, 65535),
    pageFolder: readString(input.pageFolder) ?? DEFAULT_SETTINGS.pageFolder,
    gateSecretFile: readString(input.gateSecretFile) ?? DEFAULT_SETTINGS.gateSecretFile,
    gateTicketTtlSeconds: readInteger(
      input.gateTicketTtlSeconds,
      DEFAULT_SETTINGS.gateTicketTtlSeconds,
      MIN_TICKET_TTL_SECONDS,
      MAX_TICKET_TTL_SECONDS,
    ),
  };
}

export type SettingsValidation = { ok: boolean; errors: string[] };

/**
 * Stricter than {@link normalizeSettings}: used by `onValidateConfig`, so the
 * settings form rejects typos instead of silently falling back at runtime.
 */
export function validateSettings(raw: Record<string, unknown> | null | undefined): SettingsValidation {
  const input = raw ?? {};
  const errors: string[] = [];

  const baseUrl = input.codeServerBaseUrl;
  if (baseUrl !== undefined && baseUrl !== null && baseUrl !== "") {
    if (typeof baseUrl !== "string") {
      errors.push("codeServerBaseUrl 必须是字符串");
    } else {
      try {
        const url = new URL(baseUrl.trim());
        if (url.protocol !== "http:" && url.protocol !== "https:") {
          errors.push("codeServerBaseUrl 只支持 http:// 或 https://");
        }
      } catch {
        errors.push("codeServerBaseUrl 不是合法 URL（留空表示按当前页面推导）");
      }
    }
  }

  const absolutePaths: Array<[keyof CodeServerSettings, string]> = [
    ["pageFolder", "pageFolder"],
    ["gateSecretFile", "gateSecretFile"],
  ];
  for (const [key, label] of absolutePaths) {
    const value = input[key];
    if (value === undefined || value === null) continue;
    if (typeof value !== "string" || !value.trim().startsWith("/")) {
      errors.push(`${label} 必须是绝对路径`);
    }
  }

  const integerFields: Array<[keyof CodeServerSettings, number, number]> = [
    ["codeServerPort", 1, 65535],
    ["paperclipPort", 1, 65535],
    ["gateTicketTtlSeconds", MIN_TICKET_TTL_SECONDS, MAX_TICKET_TTL_SECONDS],
  ];
  for (const [key, min, max] of integerFields) {
    const value = input[key];
    if (value === undefined || value === null || value === "") continue;
    const parsed = typeof value === "number" ? value : Number(value);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
      errors.push(`${key} 必须是 ${min}–${max} 之间的整数`);
    }
  }

  return { ok: errors.length === 0, errors };
}