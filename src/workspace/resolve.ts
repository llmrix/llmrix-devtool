/**
 * Workspace root resolution.
 *
 * Resolves the active workspace directory from multiple sources (CLI flag,
 * environment variable, process.cwd) and handles IDE-injected variable
 * placeholders that must be skipped.
 */

import path from "node:path";

import { resolvePath } from "../utils/path.js";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Detect unexpanded IDE variable placeholders.
 * Zed injects "${workspaceFolder}" literally; IntelliJ expands $PROJECT_DIR$
 * before setting the env var.
 */
function isUnexpandedVariable(value: string): boolean {
  return value.includes("${") || (value.startsWith("$") && value.endsWith("$"));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve the workspace root directory from available sources, in priority order:
 *   1. `explicitPath` — value of the `--workspace` CLI flag
 *   2. `WORKSPACE_ROOT` environment variable (skipped if unexpanded placeholder)
 *   3. `process.cwd()` — Zed sets CWD to the project root automatically
 *
 * Always returns an absolute path.
 */
export function resolveWorkspaceRoot(explicitPath?: string): string {
  if (explicitPath) return resolvePath(explicitPath);

  const envValue = process.env["WORKSPACE_ROOT"];
  if (envValue && !isUnexpandedVariable(envValue)) return resolvePath(envValue);

  return process.cwd();
}

/**
 * Describe where the workspace root came from — used in debug log messages.
 */
export function workspaceRootSource(explicitPath?: string): string {
  if (explicitPath) return "--workspace flag";

  const envValue = process.env["WORKSPACE_ROOT"];
  if (envValue && !isUnexpandedVariable(envValue)) return "WORKSPACE_ROOT env";

  return "process.cwd()";
}
