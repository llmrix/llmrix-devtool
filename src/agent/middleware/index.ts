/**
 * Custom agent middleware for codai.
 *
 * These middlewares extend the deepagents / langchain middleware pipeline with
 * capabilities not yet covered by the framework:
 *
 *  - {@link contextWindowMiddleware}      — sliding-window eviction of old
 *    messages before the agent graph executes (fills the gap between
 *    framework's token-triggered summarization and a cheap, zero-LLM-cost
 *    hard-trim)
 *
 *  - {@link toolOutputTruncationMiddleware} — per-line truncation of
 *    ToolMessage results visible to the LLM (fills the gap between
 *    framework's whole-message ClearToolUsesEdit and a partial, hint-augmented
 *    truncation that preserves the most relevant lines)
 */

export {
  contextWindowMiddleware,
  type ContextWindowMiddlewareConfig,
  DEFAULT_MAX_MESSAGES,
} from "./contextWindow.js";

export {
  toolOutputTruncationMiddleware,
  type ToolOutputTruncationMiddlewareConfig,
  DEFAULT_MAX_TOOL_OUTPUT_LINES,
} from "./toolOutputTruncation.js";
