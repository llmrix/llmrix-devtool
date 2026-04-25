/**
 * Pure utility functions for model entry operations.
 *
 * No server state, no I/O — safe to import anywhere.
 */

import type { CopilotConfig } from "../config/index.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single model entry as advertised in ACP session responses. */
export interface ModelEntry {
  /** Wire value sent as modelId / configOption value — format: "<providerId>:<modelName>" */
  value: string;
  /** Display name shown in the IDE */
  name: string;
  /** Optional description (provider name + protocol + optional baseUrl) */
  description?: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Convert CopilotConfig providers into a flat list of ModelEntry objects.
 * Each value uses the format "<providerId>:<modelName>", e.g. "anthropic:claude-opus-4-6".
 */
export function buildModelEntries(config: CopilotConfig): ModelEntry[] {
  return config.providers.flatMap((p) =>
    p.models.map((model) => ({
      value: `${p.id}:${model}`,
      name: model,
      description: p.baseUrl
        ? `${p.name} · ${p.protocol} · ${p.baseUrl}`
        : `${p.name} · ${p.protocol} protocol`,
    })),
  );
}

/**
 * Parse a "<providerId>:<modelName>" value string into its component parts.
 * Returns null when the string is not in the expected format.
 */
export function parseModelValue(
  value: string,
): { providerId: string; modelName: string } | null {
  const idx = value.indexOf(":");
  if (idx === -1) return null;
  return { providerId: value.slice(0, idx), modelName: value.slice(idx + 1) };
}
