/**
 * LLM model factory.
 *
 * Creates a LangChain BaseChatModel from a provider config entry.
 * Supports Anthropic and OpenAI protocols; resolves API keys from config or
 * well-known environment variables.
 *
 * The optional `timeoutMs` parameter sets the underlying HTTP client timeout
 * on both Anthropic and OpenAI adapters. This ensures the SDK-level socket
 * is closed when a request exceeds the budget, rather than relying solely on
 * the application-layer Promise.race() in patch-prompt.ts.
 */

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { CopilotConfig, ProviderConfig } from "../config/index.js";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function resolveProvider(config: CopilotConfig, providerId: string): ProviderConfig {
  const provider = config.providers.find((p) => p.id === providerId);
  if (provider) return provider;

  throw new Error(
    `Provider "${providerId}" not found in config. ` +
      `Available providers: ${config.providers.map((p) => p.id).join(", ") || "(none)"}.`,
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a LangChain `BaseChatModel` instance from the given config.
 *
 * @param config       - Loaded copilot config
 * @param providerName - Provider id (e.g. "anthropic", "openai", "deepseek")
 * @param modelName    - Optional model override; falls back to `config.model`
 * @param timeoutMs    - Optional HTTP-level timeout in ms (0 = no timeout).
 *                       Aligns the SDK's own socket timeout with the
 *                       application-layer timeout in patch-prompt.ts so that
 *                       a slow provider triggers a clean abort rather than
 *                       an OS-level connection reset.
 */
export async function createModel(
  config: CopilotConfig,
  providerName: string,
  modelName?: string,
  timeoutMs?: number,
): Promise<BaseChatModel> {
  const provider = resolveProvider(config, providerName);
  const model = modelName ?? config.model;

  // Effective HTTP timeout: caller-supplied > config value > no timeout.
  // We use (timeoutMs ?? config.timeoutMs ?? 0) so that 0 means disabled.
  const httpTimeout = timeoutMs ?? config.timeoutMs ?? 0;

  if (provider.models.length > 0 && !provider.models.includes(model)) {
    process.stderr.write(
      `[codai] Warning: model "${model}" is not in provider "${providerName}" ` +
        `model list: [${provider.models.join(", ")}]\n`,
    );
  }

  if (provider.protocol === "anthropic") {
    const { ChatAnthropic } = await import("@langchain/anthropic");
    const effectiveApiKey =
      provider.apiKey?.trim() ||
      process.env["ANTHROPIC_AUTH_TOKEN"]?.trim() ||
      process.env["ANTHROPIC_API_KEY"]?.trim();

    if (!effectiveApiKey) {
      throw new Error(
        `No API key configured for provider "${providerName}". ` +
          `Set apiKey in config or the ANTHROPIC_API_KEY environment variable.`,
      );
    }

    return new ChatAnthropic({
      model,
      apiKey: effectiveApiKey,
      ...(provider.baseUrl ? { anthropicApiUrl: provider.baseUrl } : {}),
      // Set SDK-level timeout so the underlying socket is closed on timeout,
      // not just the Promise abandoned. Value of 0 keeps the SDK default.
      ...(httpTimeout > 0 ? { timeout: httpTimeout } : {}),
    }) as unknown as BaseChatModel;
  }

  if (provider.protocol === "openai") {
    const { ChatOpenAI } = await import("@langchain/openai");
    const effectiveApiKey =
      provider.apiKey?.trim() || process.env["OPENAI_API_KEY"]?.trim();

    if (!effectiveApiKey) {
      throw new Error(
        `No API key configured for provider "${providerName}". ` +
          `Set apiKey in config or the OPENAI_API_KEY environment variable.`,
      );
    }

    return new ChatOpenAI({
      model,
      apiKey: effectiveApiKey,
      ...(provider.baseUrl
        ? { configuration: { baseURL: provider.baseUrl } }
        : {}),
      // timeout here maps to openai-node's `timeout` option (ms).
      ...(httpTimeout > 0 ? { timeout: httpTimeout } : {}),
    }) as unknown as BaseChatModel;
  }

  const _exhaustive: never = provider.protocol;
  throw new Error(`Unknown protocol: ${String(_exhaustive)}`);
}
