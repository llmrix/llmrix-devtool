/**
 * Context-window sliding-window middleware.
 *
 * deepagents ships a `SummarizationMiddleware` that fires at ~85% of the
 * model's max-input-token budget via `wrapModelCall`.  We cannot register a
 * second middleware with the same name (ReactAgent enforces unique names), and
 * we cannot change the built-in trigger threshold from outside the framework.
 *
 * This middleware operates one stage earlier — in `beforeAgent` — before the
 * agent graph starts executing for the current turn.  It applies a simple
 * sliding-window eviction: when the raw message count exceeds `maxMessages`,
 * the oldest messages (excluding any leading summarization placeholders) are
 * dropped from state.  This keeps the history compact so that the built-in
 * SummarizationMiddleware sees a smaller input and triggers less frequently,
 * reducing per-request token cost.
 *
 * Evicted messages are *not* summarised here — that is the built-in
 * middleware's responsibility.  Set `maxMessages` large enough (default: 40)
 * that the built-in summarization still captures important context before the
 * sliding window discards it.
 *
 * Middleware name: `"ContextWindowMiddleware"` — distinct from the framework's
 * `"SummarizationMiddleware"` to satisfy the uniqueness constraint.
 *
 * @example
 * ```ts
 * import { contextWindowMiddleware } from "./middleware/contextWindow.js";
 *
 * const agent = createAgent({
 *   middleware: [contextWindowMiddleware({ maxMessages: 60 })],
 * });
 * ```
 */

import { createMiddleware } from "langchain";
import { HumanMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Configuration options for {@link contextWindowMiddleware}. */
export interface ContextWindowMiddlewareConfig {
  /**
   * Maximum number of messages to keep in the active context window.
   * Leading summarization placeholders are exempt and always kept.
   * Defaults to {@link DEFAULT_MAX_MESSAGES}.
   * Set to `0` to disable eviction entirely.
   */
  maxMessages: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default context-window size used when `maxMessages` is not configured. */
export const DEFAULT_MAX_MESSAGES = 40;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Returns `true` when the message is a summarization placeholder produced by
 * deepagents' SummarizationMiddleware (`lc_source = "summarization"`).
 * These messages must not be evicted because they carry compressed history.
 */
function isSummaryMessage(msg: unknown): boolean {
  if (!(msg instanceof HumanMessage)) return false;
  return (
    (msg.additional_kwargs as Record<string, unknown>)?.["lc_source"] ===
    "summarization"
  );
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a middleware that trims the conversation history to
 * `config.maxMessages` messages before the agent graph executes each turn.
 *
 * Summary messages produced by the built-in SummarizationMiddleware are
 * always kept — they sit at the front of the list and are exempt from
 * eviction so that previously compressed context is not lost.
 *
 * @param config - {@link ContextWindowMiddlewareConfig}
 */
export function contextWindowMiddleware(config: ContextWindowMiddlewareConfig) {
  const { maxMessages } = config;

  if (maxMessages <= 0) {
    return createMiddleware({
      name: "ContextWindowMiddleware(disabled)",
      async beforeAgent() {
        return undefined;
      },
    });
  }

  return createMiddleware({
    name: `ContextWindowMiddleware(max=${maxMessages})`,

    async beforeAgent(state: Record<string, unknown>) {
      const messages = (state["messages"] as unknown[]) ?? [];
      if (messages.length <= maxMessages) return undefined;

      // Partition: leading summary messages (always kept) + regular messages
      // (subject to the sliding window).
      let summaryBoundary = 0;
      while (
        summaryBoundary < messages.length &&
        isSummaryMessage(messages[summaryBoundary])
      ) {
        summaryBoundary++;
      }

      const summaries = messages.slice(0, summaryBoundary);
      const regular = messages.slice(summaryBoundary);

      const regularBudget = Math.max(maxMessages - summaries.length, 1);
      if (regular.length <= regularBudget) return undefined;

      const trimmed = [
        ...summaries,
        ...regular.slice(regular.length - regularBudget),
      ] as BaseMessage[];

      return { messages: trimmed };
    },
  });
}
