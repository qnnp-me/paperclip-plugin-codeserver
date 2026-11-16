/**
 * Minimal worker. The plugin is UI-only; the worker exists because Paperclip
 * requires `entrypoints.worker`, and it keeps the plugin's health diagnostics
 * meaningful without doing any autonomous work.
 */
import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";

const plugin = definePlugin({
  async setup(ctx) {
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

export default plugin;

runWorker(plugin, import.meta.url);