/**
 * code-server plugin worker entrypoint.
 *
 * The definition lives in `plugin.ts` (side-effect free, testable). This file
 * only boots the worker RPC loop.
 */
import { runWorker } from "@paperclipai/plugin-sdk";
import plugin from "./plugin.ts";

export default plugin;

runWorker(plugin, import.meta.url);