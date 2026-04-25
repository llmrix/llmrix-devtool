/**
 * Domain types for codai configuration.
 *
 * Kept separate from the loader so any module that only needs the types
 * can import without pulling in fs/path/os I/O dependencies.
 */

/** Configuration for a single LLM provider (built-in or custom). */
export interface ProviderConfig {
  /** Unique identifier used when referencing this provider (e.g. "anthropic", "deepseek") */
  id: string;
  /** Human-readable display name */
  name: string;
  /** Protocol implementation to use: "anthropic" or "openai" */
  protocol: "anthropic" | "openai";
  /** API key — may contain ${ENV_VAR} placeholders */
  apiKey: string;
  /** Optional base URL for the provider API */
  baseUrl?: string;
  /** List of available model names for this provider */
  models: string[];
}

/** Root configuration schema for config.json. */
export interface CopilotConfig {
  /** ID of the active provider (must match a `providers[].id`) */
  provider: string;
  /** Name of the active model */
  model: string;
  /** All providers (built-in and custom) */
  providers: ProviderConfig[];
  /**
   * LLM request timeout in milliseconds.
   * Defaults to 600_000 (10 minutes) when omitted.
   * Set to 0 to disable the timeout entirely.
   */
  timeoutMs?: number;
  /**
   * Maximum number of messages kept in the active context window before the
   * oldest ones are evicted.  Leading summarization messages are exempt and
   * are always kept.  Defaults to 40.  Set to 0 to disable.
   */
  maxMessages?: number;
  /**
   * Maximum number of lines returned by a single tool call (file read, grep,
   * shell output, etc.).  Responses longer than this are truncated and a
   * notice is appended so the agent can request a more targeted query.
   * Defaults to 500.  Set to 0 to disable truncation.
   */
  maxToolOutputLines?: number;
}
