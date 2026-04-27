/**
 * Config file loader.
 *
 * Responsible for: candidate path resolution, JSON parsing, legacy format
 * migration, and merging with built-in defaults.
 *
 * Types live in ./types.ts so other modules can import them without pulling
 * in the fs/path/os I/O here.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePath } from "../utils/path.js";
import { resolveEnvVars } from "../utils/env.js";
import { USER_CONFIG_FILE, WORKSPACE_CONFIG_FILE, ENV_CONFIG_VAR, APP_NAME } from "../constants.js";
import type { CopilotConfig, ProviderConfig } from "./types.js";

// ---------------------------------------------------------------------------
// Built-in defaults
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: CopilotConfig = {
  provider: "anthropic",
  model: "claude-sonnet-4-5-20250929",
  providers: [
    {
      id: "anthropic",
      name: "Anthropic",
      protocol: "anthropic",
      apiKey: "",
      models: [
        "claude-opus-4-6",
        "claude-sonnet-4-6",
        "claude-sonnet-4-5-20250929",
        "claude-haiku-4-5-20251001",
      ],
    },
    {
      id: "openai",
      name: "OpenAI",
      protocol: "openai",
      apiKey: "",
      models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "o1", "o3-mini"],
    },
  ],
};

// ---------------------------------------------------------------------------
// Candidate path resolution
// ---------------------------------------------------------------------------

/**
 * Return candidate config file paths in priority order (first readable wins):
 * 1. Explicit `configPath` argument
 * 2. `${ENV_CONFIG_VAR}` environment variable
 * 3. `./.llmrix/config.json` (Project)
 * 4. `~/.llmrix/config/config.json` (Global)
 * 5. `config.json` bundled next to the compiled binary
 */
function candidatePaths(configPath?: string): string[] {
  const candidates: string[] = [];

  if (configPath) candidates.push(resolvePath(configPath));

  const envPath = process.env[ENV_CONFIG_VAR];
  if (envPath) candidates.push(resolvePath(envPath));

  candidates.push(path.resolve(process.cwd(), WORKSPACE_CONFIG_FILE));
  candidates.push(USER_CONFIG_FILE);

  try {
    const __filename = fileURLToPath(import.meta.url);
    // dist/config/loader.js → ../../config.json
    candidates.push(path.resolve(path.dirname(__filename), "..", "..", "config.json"));
  } catch {
    // import.meta.url unavailable in some edge cases — skip
  }

  return candidates;
}

// ---------------------------------------------------------------------------
// Legacy format migration
// ---------------------------------------------------------------------------

/**
 * Migrate a legacy config (providers: Record + customProviders: Array) to the
 * current unified `providers: ProviderConfig[]` format.
 * Returns `undefined` when the input is already in the current format.
 */
function migrateLegacy(raw: Record<string, unknown>): ProviderConfig[] | undefined {
  const hasLegacyProviders =
    raw["providers"] !== undefined && !Array.isArray(raw["providers"]);
  const hasCustomProviders = Array.isArray(raw["customProviders"]);

  if (!hasLegacyProviders && !hasCustomProviders) return undefined;

  const result: ProviderConfig[] = [];

  if (hasLegacyProviders) {
    const record = raw["providers"] as Record<string, Omit<ProviderConfig, "id" | "name">>;
    for (const [id, cfg] of Object.entries(record)) {
      result.push({ id, name: id.charAt(0).toUpperCase() + id.slice(1), ...cfg });
    }
  }

  if (hasCustomProviders) {
    result.push(...(raw["customProviders"] as ProviderConfig[]));
  }

  return result.length > 0 ? result : undefined;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load and parse a `CopilotConfig` from the file system.
 *
 * Resolution order (first readable file wins):
 * 1. Explicit `configPath` argument
 * 2. `${ENV_CONFIG_VAR}` env var
 * 3. `./.llmrix/config.json` (Project)
 * 4. `~/.llmrix/config/config.json` (Global)
 * 5. Bundled `config.json` next to the binary
 * 6. Built-in defaults (no file found)
 */
export function loadConfig(configPath?: string): CopilotConfig {
  const explicit = new Set<string>();
  if (configPath) explicit.add(resolvePath(configPath));
  const envPath = process.env[ENV_CONFIG_VAR];
  if (envPath) explicit.add(resolvePath(envPath));

  for (const candidate of candidatePaths(configPath)) {
    if (!fs.existsSync(candidate)) continue;

    try {
      const raw = JSON.parse(fs.readFileSync(candidate, "utf-8")) as Record<string, unknown>;
      const migratedProviders = migrateLegacy(raw);
      const parsed = raw as {
        provider?: string;
        model?: string;
        providers?: ProviderConfig[];
        timeoutMs?: number;
        maxMessages?: number;
        maxToolOutputLines?: number;
      };

      const providers: ProviderConfig[] =
        migratedProviders ??
        (Array.isArray(parsed.providers) ? parsed.providers : DEFAULT_CONFIG.providers);

      return resolveEnvVars({
        provider: parsed.provider ?? DEFAULT_CONFIG.provider,
        model: parsed.model ?? DEFAULT_CONFIG.model,
        providers,
        ...(typeof parsed.timeoutMs === "number" ? { timeoutMs: parsed.timeoutMs } : {}),
        ...(typeof parsed.maxMessages === "number" ? { maxMessages: parsed.maxMessages } : {}),
        ...(typeof parsed.maxToolOutputLines === "number"
          ? { maxToolOutputLines: parsed.maxToolOutputLines }
          : {}),
      });
    } catch (err) {
      // If this was an explicitly supplied path (--config / env var), the user
      // clearly intends it to be used — a parse failure is a hard error.
      if (explicit.has(candidate)) {
        throw new Error(
          `Failed to parse config file at "${candidate}": ${String(err)}`,
        );
      }
      // For auto-discovered paths, warn and keep trying the next candidate.
      process.stderr.write(
        `[${APP_NAME}] Warning: failed to parse config at ${candidate}: ${String(err)}\n`,
      );
    }
  }

  return { ...DEFAULT_CONFIG };
}
