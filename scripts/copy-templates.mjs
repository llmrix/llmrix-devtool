#!/usr/bin/env node
/**
 * copy-templates.mjs
 *
 * Copies src/templates/ → dist/templates/ after `tsc` compilation.
 * Run automatically as part of `npm run build`.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const src = path.join(root, "src", "templates");
const dst = path.join(root, "dist", "templates");

fs.mkdirSync(dst, { recursive: true });

const files = fs.readdirSync(src).filter(file => {
  // Skip empty files (e.g. placeholders pending deletion)
  const stat = fs.statSync(path.join(src, file));
  return stat.isFile() && stat.size > 0;
});

for (const file of files) {
  fs.copyFileSync(path.join(src, file), path.join(dst, file));
}

// Copy default config.json to dist root for postinstall
fs.copyFileSync(path.join(root, "config.json"), path.join(root, "dist", "config.json"));

console.log(`[build] templates/ → dist/templates/ (${files.length} file${files.length !== 1 ? "s" : ""})`);
