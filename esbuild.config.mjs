import { build, context } from "esbuild";

const watch = process.argv.includes("--watch");

const shared = {
  bundle: true,
  format: "esm",
  target: "es2022",
  sourcemap: true,
  logLevel: "info",
};

/** @type {import("esbuild").BuildOptions[]} */
const configs = [
  {
    ...shared,
    entryPoints: ["src/manifest.ts"],
    outfile: "dist/manifest.js",
    platform: "node",
  },
  {
    ...shared,
    entryPoints: ["src/worker.ts"],
    outfile: "dist/worker.js",
    platform: "node",
  },
  {
    ...shared,
    entryPoints: ["src/ui/index.tsx"],
    outfile: "dist/ui/index.js",
    platform: "browser",
    jsx: "automatic",
    // The host rewrites these bare specifiers to its own runtimes at import time.
    external: [
      "react",
      "react-dom",
      "react-dom/client",
      "react/jsx-runtime",
      "@paperclipai/plugin-sdk/ui",
    ],
  },
];

if (watch) {
  const contexts = await Promise.all(configs.map((config) => context(config)));
  await Promise.all(contexts.map((ctx) => ctx.watch()));
  console.log("watching plugin sources…");
} else {
  await Promise.all(configs.map((config) => build(config)));
}