/**
 * Plugin definition (no side effects).
 *
 * Kept separate from `worker.ts` so tests can import the definition, register
 * it on the SDK test harness, and exercise the real capability gates without
 * booting the worker RPC loop.
 */
import { definePlugin } from "@paperclipai/plugin-sdk";
import { normalizeSettings, validateSettings, type CodeServerSettings } from "./config.ts";
import { issueGateTicket } from "./gate.ts";
import { resolveWorkspace, type WorkspaceRequest } from "./resolve.ts";

/** Minimal surface needed to read config; keeps this module testable. */
type ConfigContext = {
  config: { get(companyId?: string): Promise<Record<string, unknown>> };
  logger: { warn(message: string, details?: Record<string, unknown>): void };
};

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Operator settings for one company, merged over built-in defaults.
 * Configuration is runtime data: a bad or missing row must not break the
 * editor, so failures fall back to defaults and log once per call.
 */
export async function readSettings(
  ctx: ConfigContext,
  companyId?: unknown,
): Promise<CodeServerSettings> {
  const scope = readString(companyId);
  if (!scope) return normalizeSettings(null);
  try {
    return normalizeSettings(await ctx.config.get(scope));
  } catch (error) {
    ctx.logger.warn("读取插件配置失败，使用默认值", { error: String(error) });
    return normalizeSettings(null);
  }
}

export const pluginDefinition = definePlugin({
  async setup(ctx) {
    ctx.data.register("workspace", async (params) => {
      return resolveWorkspace(
        {
          issues: ctx.issues,
          executionWorkspaces: ctx.executionWorkspaces,
          projects: ctx.projects,
        },
        params as WorkspaceRequest,
      );
    });
    // Operator settings for the UI (URL derivation, default folder). Never
    // returns secret material: the gate secret stays on disk.
    ctx.data.register("settings", async (params) => {
      return readSettings(ctx, params.companyId);
    });
    // Short-lived ticket for the cs-gate proxy: the browser never sees the
    // code-server password, the proxy injects the session server-side.
    ctx.data.register("gate", async (params) => {
      const settings = await readSettings(ctx, params.companyId);
      return issueGateTicket({
        ttlSeconds: settings.gateTicketTtlSeconds,
        secretFile: settings.gateSecretFile,
      });
    });
    ctx.logger.info("qnnp.codeserver worker ready");
  },
  async onValidateConfig(config) {
    return validateSettings(config);
  },
  async onHealth() {
    return { status: "ok" };
  },
  // No timers, sockets, or detached work: never hold the instance awake.
  async onIdleDrain() {
    return "none" as const;
  },
});

export default pluginDefinition;