/**
 * Shared application-level constants.
 *
 * Single source of truth for the package name, version, and well-known paths
 * that are referenced across multiple modules (config loader, checkpointer,
 * postinstall script, CLI help text, server metadata).
 */

import path from "node:path";
import os from "node:os";

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export const APP_NAME = "llmrix-devtool";
export const APP_VERSION = "0.0.1";

/** Internal name used for config directories and environment variables (e.g., "llmrix") */
export const CONFIG_NAME = "llmrix";

/** The hidden directory name (e.g., ".llmrix") */
export const DOT_CONFIG_NAME = `.${CONFIG_NAME}`;

/** The environment variable name for config (e.g., "LLMRIX_CONFIG") */
export const ENV_CONFIG_VAR = `${CONFIG_NAME.toUpperCase().replace(/-/g, "_")}_CONFIG`;

// ---------------------------------------------------------------------------
// User-level directory structure (~/.llmrix)
// ---------------------------------------------------------------------------

export const USER_DATA_DIR = path.join(os.homedir(), DOT_CONFIG_NAME);

/** User config directory (~/.llmrix/config) */
export const USER_CONFIG_DIR = path.join(USER_DATA_DIR, "config");
export const USER_CONFIG_FILE = path.join(USER_CONFIG_DIR, "config.json");

export const SESSIONS_DB_PATH = path.join(USER_DATA_DIR, "sessions", "sessions.db");
export const GLOBAL_MEMORY_FILE = path.join(USER_DATA_DIR, "memory", "AGENTS.md");
export const GLOBAL_SKILLS_DIR = path.join(USER_DATA_DIR, "skills");

// ---------------------------------------------------------------------------
// Workspace-level constants
// ---------------------------------------------------------------------------

/** Hidden directory inside the workspace (e.g., ".llmrix/") */
export const WORKSPACE_DATA_DIR = DOT_CONFIG_NAME;
export const WORKSPACE_MEMORY_DIR = path.join(WORKSPACE_DATA_DIR, "memory");
export const WORKSPACE_SKILLS_DIR = path.join(WORKSPACE_DATA_DIR, "skills");
export const WORKSPACE_AGENTS_FILE = path.join(WORKSPACE_MEMORY_DIR, "AGENTS.md");

