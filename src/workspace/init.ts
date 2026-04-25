/**
 * Workspace skeleton initialisation.
 *
 * Creates the expected ${APP_NAME} directory structure inside a workspace root
 * when it doesn't already exist. All operations are non-fatal — a read-only
 * workspace simply skips missing files.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { APP_NAME, WORKSPACE_DATA_DIR, WORKSPACE_AGENTS_FILE } from "../constants.js";

// ---------------------------------------------------------------------------
// Template loader
// ---------------------------------------------------------------------------

/**
 * Resolve the absolute path to the bundled `templates/` directory.
 *
 * Works in both environments:
 *  - TypeScript source (tsx / ts-node):  <repo>/src/templates/
 *  - Compiled output  (node dist/):      <repo>/dist/templates/
 *
 * `templates/` is always a sibling of the *parent* directory of this file
 * (src/workspace/ → src/templates/ or dist/workspace/ → dist/templates/).
 */
function templatesDir(): string {
  const __filename = fileURLToPath(import.meta.url);
  return path.join(path.dirname(__filename), "..", "templates");
}

function readTemplate(filename: string, fallback: string): string {
  try {
    return fs.readFileSync(path.join(templatesDir(), filename), "utf-8");
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Ensure the workspace contains the expected ${APP_NAME} skeleton:
 *
 *   <workspaceRoot>/
 *     ${WORKSPACE_AGENTS_FILE}    ← project-level memory (created if missing)
 *     ${WORKSPACE_DATA_DIR}/
 *       skills/
 *         .gitkeep               ← keeps the directory tracked by git
 *
 * Existing files are never overwritten.
 */
export function initWorkspace(workspaceRoot: string): void {
  // <workspaceRoot>/AGENTS.md
  const agentsMd = path.join(workspaceRoot, WORKSPACE_AGENTS_FILE);
  if (!fs.existsSync(agentsMd)) {
    try {
      fs.writeFileSync(agentsMd, readTemplate(WORKSPACE_AGENTS_FILE, "# Agent Memory\n"), "utf-8");
    } catch {
      // Non-fatal — workspace may be read-only
    }
  }

  // <workspaceRoot>/.llmrix/skills/.gitkeep
  const skillsDir = path.join(workspaceRoot, WORKSPACE_DATA_DIR, "skills");
  const gitkeep = path.join(skillsDir, ".gitkeep");
  if (!fs.existsSync(gitkeep)) {
    try {
      fs.mkdirSync(skillsDir, { recursive: true });
      fs.writeFileSync(gitkeep, "", "utf-8");
    } catch {
      // Non-fatal
    }
  }
}
