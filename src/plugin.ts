/**
 * Plugin definition (no side effects).
 *
 * Kept separate from `worker.ts` so tests can import the definition, register
 * it on the SDK test harness, and exercise the real capability gates without
 * booting the worker RPC loop.
 */
import { definePlugin } from "@paperclipai/plugin-sdk";
import { issueGateTicket } from "./gate.ts";
import { resolveWorkspace, type WorkspaceRequest } from "./resolve.ts";

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
    // Short-lived ticket for the cs-gate proxy: the browser never sees the
    // code-server password, the proxy injects the session server-side.
    ctx.data.register("gate", async () => issueGateTicket());
    ctx.logger.info("qnnp.codeserver worker ready");
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