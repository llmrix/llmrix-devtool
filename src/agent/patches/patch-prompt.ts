/**
 * Patch: handlePrompt
 *
 * Two improvements over deepagents-acp's default behaviour:
 *
 *  1. Error-to-chat conversion — deepagents-acp re-throws prompt errors, which
 *     IntelliJ silently discards. We catch errors and send them as visible chat
 *     messages instead.
 *
 *  2. Configurable timeout with AbortController — deepagents-acp has no LLM
 *     request timeout. We wrap the call in a race and signal an AbortController
 *     so the underlying HTTP request is actively cancelled (not just abandoned)
 *     when the timeout fires. The timer is unref()'d so it never prevents the
 *     Node.js process from exiting cleanly.
 */

import type { AnyServer } from "./patch-initialize.js";

export function patchPrompt(self: AnyServer, timeoutMs: number, debug: boolean): void {
  const original = (self["handlePrompt"] as (
    params: Record<string, unknown>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    conn: any,
  ) => Promise<Record<string, unknown>>).bind(self);

  self["handlePrompt"] = async (
    params: Record<string, unknown>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    conn: any,
  ): Promise<Record<string, unknown>> => {
    const sessionId = params["sessionId"] as string;

    try {
      if (timeoutMs > 0) {
        // AbortController allows us to actively cancel the underlying HTTP
        // request rather than merely racing against an ignored promise.
        const controller = new AbortController();

        // Inject the signal into params so deepagents-acp / LangChain can
        // honour it when forwarding to the provider SDK.
        const paramsWithSignal: Record<string, unknown> = {
          ...params,
          signal: controller.signal,
        };

        // The HTTP-socket timeout on the model is set to the same value
        // (see createModel / patch-model-switch), so both layers fire at the
        // same budget. We add a 5-second grace period here so the application
        // layer aborts first and produces a user-friendly message before the
        // SDK-level socket reset would surface a raw network error.
        const appTimeoutMs = Math.max(timeoutMs - 5_000, timeoutMs);
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(
              new Error(
                `LLM request timed out after ${timeoutMs / 1000}s. ` +
                  `Check provider connectivity and API key. ` +
                  `You can increase the timeout via "timeoutMs" in config.json ` +
                  `(current: ${timeoutMs}ms), or set it to 0 to disable.`,
              ),
            );
          }, appTimeoutMs);
        });

        // Prevent the timer from keeping the Node.js event loop alive after
        // the server is otherwise done — avoids zombie processes on exit.
        timer?.unref?.();

        try {
          return await Promise.race([original(paramsWithSignal, conn), timeout]);
        } finally {
          clearTimeout(timer);
          // Abort any still-pending request to free underlying resources.
          if (!controller.signal.aborted) controller.abort();
        }
      }
      return await original(params, conn);
    } catch (error) {
      // Surface abort errors with a friendlier message.
      const isAbort =
        error instanceof Error &&
        (error.name === "AbortError" || error.message.includes("aborted"));

      const message =
        isAbort
          ? `LLM request was cancelled (connection aborted). ` +
            `This usually means the request timed out or was interrupted. ` +
            `Check provider connectivity and API key.`
          : error instanceof Error
            ? error.message
            : String(error);

      const detail =
        debug && !isAbort && error instanceof Error && error.stack
          ? `\n\`\`\`\n${error.stack}\n\`\`\``
          : "";

      await (self["sendMessageChunk"] as Function)(sessionId, conn, "agent", [
        { type: "text", text: `⚠️ **Error:** ${message}${detail}` },
      ]);
      return { stopReason: "end_turn" };
    }
  };
}
