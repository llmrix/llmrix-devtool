/**
 * Tool-output truncation middleware.
 *
 * Large tool results — file reads, grep output, shell stdout — can consume
 * thousands of tokens, bloating the context window and driving up cost.
 * This middleware intercepts every model call and truncates any ToolMessage
 * whose content exceeds `maxLines` lines, appending a concise notice so the
 * agent can issue a more targeted follow-up query.
 *
 * Truncation is applied only to the *messages list visible to the LLM*, not
 * to the stored checkpoint state.  The raw result is therefore preserved for
 * possible later reference; only the in-flight context is trimmed.
 *
 * This complements the framework's `ClearToolUsesEdit` (which replaces whole
 * messages with `"[cleared]"`) and `FilesystemMiddleware` eviction (which
 * offloads content to disk).  Unlike those approaches, this middleware keeps
 * the most relevant lines and adds a navigational hint, preserving partial
 * context rather than discarding it entirely.
 *
 * @example
 * ```ts
 * import { toolOutputTruncationMiddleware } from "./middleware/toolOutputTruncation.js";
 *
 * const agent = createAgent({
 *   middleware: [toolOutputTruncationMiddleware({ maxLines: 300 })],
 * });
 * ```
 */

import { createMiddleware } from "langchain";
import { ToolMessage } from "@langchain/core/messages";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Configuration options for {@link toolOutputTruncationMiddleware}. */
export interface ToolOutputTruncationMiddlewareConfig {
  /**
   * Maximum number of lines allowed in a single tool result.
   * Results exceeding this are truncated and a notice is appended.
   * Defaults to {@link DEFAULT_MAX_TOOL_OUTPUT_LINES}.
   * Set to `0` to disable truncation entirely.
   */
  maxLines: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default line limit used when `maxLines` is not configured. */
export const DEFAULT_MAX_TOOL_OUTPUT_LINES = 500;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Truncate a single ToolMessage to `maxLines` lines.
 * Returns the original message unchanged when no truncation is needed.
 */
function truncateToolMessage(msg: ToolMessage, maxLines: number): ToolMessage {
  const raw =
    typeof msg.content === "string"
      ? msg.content
      : JSON.stringify(msg.content);

  const lines = raw.split("\n");
  if (lines.length <= maxLines) return msg;

  const kept = lines.slice(0, maxLines).join("\n");
  const remaining = lines.length - maxLines;
  const truncated =
    `${kept}\n` +
    `\n[Output truncated: ${remaining} more line${remaining === 1 ? "" : "s"} omitted. ` +
    `Use a more targeted query (e.g. grep, specific line range) to retrieve the rest.]`;

  return new ToolMessage({
    content: truncated,
    tool_call_id: msg.tool_call_id,
    name: msg.name,
  });
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a middleware that truncates tool call results to `config.maxLines`
 * lines before each model invocation.
 *
 * Only the context passed to the LLM is trimmed — the checkpoint state is
 * not modified, so the original output remains available if needed.
 *
 * @param config - {@link ToolOutputTruncationMiddlewareConfig}
 */
export function toolOutputTruncationMiddleware(
  config: ToolOutputTruncationMiddlewareConfig,
) {
  const { maxLines } = config;

  if (maxLines <= 0) {
    return createMiddleware({
      name: "ToolOutputTruncationMiddleware(disabled)",
      wrapModelCall(request, handler) {
        return handler(request);
      },
    });
  }

  return createMiddleware({
    name: `ToolOutputTruncationMiddleware(maxLines=${maxLines})`,

    wrapModelCall(request, handler) {
      const messages = request.messages ?? [];

      const truncated = messages.map((msg) =>
        msg instanceof ToolMessage ? truncateToolMessage(msg, maxLines) : msg,
      );

      return handler({ ...request, messages: truncated });
    },
  });
}
