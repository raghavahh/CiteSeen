// Build for Cloudflare Pages: copy public/ → dist/ and bundle the Worker into dist/_worker.js.
import { build } from "esbuild";
import { cpSync, rmSync } from "node:fs";

rmSync("dist", { recursive: true, force: true });
cpSync("public", "dist", { recursive: true });
await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/_worker.js",
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  minify: true,
  logLevel: "info",
});
