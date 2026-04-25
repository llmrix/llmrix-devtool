#!/usr/bin/env node
/**
 * postinstall — runs automatically after `npm install -g ${APP_NAME}`.
 *
 * Initialises the user-level config file at:
 *   ~/.${CONFIG_NAME}/config/config.json
 *
 * Rules:
 *  - If the file already exists, it is never overwritten.
 *  - The directory is created recursively if it does not exist.
 *  - All output goes to stdout so the user sees it inline with npm install.
 *  - Errors are non-fatal: a warning is printed and the process exits 0.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Import shared path constants from the compiled dist tree.
// This script lives at dist/scripts/postinstall.js at runtime,
// so the relative import resolves to dist/constants.js correctly.
import {
  APP_NAME,
  USER_CONFIG_DIR,
  USER_CONFIG_FILE,
  USER_DATA_DIR,
  GLOBAL_MEMORY_FILE,
  GLOBAL_SKILLS_DIR,
  SESSIONS_DB_PATH,
} from "../constants.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the bundled config.json that ships next to the compiled binary.
 * dist/scripts/postinstall.js → ../../config.json → <package-root>/config.json
 */
function getBundledConfigPath(): string {
  try {
    const __filename = fileURLToPath(import.meta.url);
    return path.resolve(path.dirname(__filename), "..", "..", "config.json");
  } catch {
    return path.resolve(process.cwd(), "config.json");
  }
}

/**
 * Resolve the bundled templates that ship next to the compiled binary.
 * dist/scripts/postinstall.js → ../templates/
 */
function getBundledTemplatePath(filename: string): string {
  try {
    const __filename = fileURLToPath(import.meta.url);
    return path.resolve(path.dirname(__filename), "..", "templates", filename);
  } catch {
    return path.resolve(process.cwd(), "src", "templates", filename);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const isGlobal = process.env["npm_config_global"] === "true";
  const isNpmInstall = !!process.env["npm_lifecycle_event"];

  // Only run automatically for global installs
  if (isNpmInstall && !isGlobal) {
    process.exit(0);
  }

  console.log(`[${APP_NAME}] Initialising global directories...`);

  // 1. Create directory structure
  const dirs = [
    USER_CONFIG_DIR,
    path.dirname(GLOBAL_MEMORY_FILE),
    GLOBAL_SKILLS_DIR,
    path.dirname(SESSIONS_DB_PATH),
  ];

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch (err) {
        console.warn(`[${APP_NAME}] Warning: could not create directory ${dir}: ${String(err)}`);
      }
    }
  }

  // 2. Initialize config.json if missing
  if (!fs.existsSync(USER_CONFIG_FILE)) {
    const bundledConfig = getBundledConfigPath();
    if (fs.existsSync(bundledConfig)) {
      try {
        fs.copyFileSync(bundledConfig, USER_CONFIG_FILE);
        console.log(`[${APP_NAME}] Config initialised at ${USER_CONFIG_FILE}`);
      } catch (err) {
        console.warn(`[${APP_NAME}] Warning: could not copy config: ${String(err)}`);
      }
    }
  }

  // 3. Initialize AGENTS.md if missing
  if (!fs.existsSync(GLOBAL_MEMORY_FILE)) {
    const bundledAgents = getBundledTemplatePath("AGENTS.md");
    if (fs.existsSync(bundledAgents)) {
      try {
        fs.copyFileSync(bundledAgents, GLOBAL_MEMORY_FILE);
        console.log(`[${APP_NAME}] Global memory initialised at ${GLOBAL_MEMORY_FILE}`);
      } catch (err) {
        console.warn(`[${APP_NAME}] Warning: could not copy AGENTS.md: ${String(err)}`);
      }
    }
  }

  console.log(`
[${APP_NAME}] Setup complete.

Next steps:
  1. Open the file and set your API key(s):
     ${USER_CONFIG_FILE}

  2. Configure your IDE (see README for Zed / JetBrains setup).

Run \`${APP_NAME} --help\` for available options.
`);
}

main();
