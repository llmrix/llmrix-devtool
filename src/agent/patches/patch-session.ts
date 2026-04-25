/**
 * Patch: handleNewSession + handleLoadSession
 *
 * Injects `models` (availableModels + currentModelId) into every session
 * lifecycle response so the IDE can show and switch between models.
 *
 * Also fixes a race condition in deepagents-acp: it fires `session/update`
 * notifications (available_commands_update) BEFORE returning the
 * NewSessionResponse. Clients cannot route notifications for a session they
 * haven't acknowledged yet. We buffer those notifications via a Proxy on the
 * connection object and replay them after the response is returned.
 */

import type { ModelEntry } from "../../providers/model-utils.js";
import type { AnyServer } from "./patch-initialize.js";

// ---------------------------------------------------------------------------
// Shared helper
// ---------------------------------------------------------------------------

export function appendModelState(
  response: Record<string, unknown>,
  sessionModels: Map<string, string>,
  entries: ModelEntry[],
  getDefault: () => string,
  explicitSessionId?: string,
): Record<string, unknown> {
  if (entries.length === 0) return response;

  const sessionId =
    (response["sessionId"] as string | undefined) ?? explicitSessionId;

  if (sessionId && !sessionModels.has(sessionId)) {
    sessionModels.set(sessionId, getDefault());
  }
  const currentModelId =
    (sessionId ? sessionModels.get(sessionId) : undefined) ?? getDefault();

  return {
    ...response,
    models: {
      availableModels: entries.map((e) => ({
        modelId: e.value,
        name: e.name,
        description: e.description ?? null,
      })),
      currentModelId,
    },
  };
}

// ---------------------------------------------------------------------------
// Patches
// ---------------------------------------------------------------------------

export function patchNewSession(
  self: AnyServer,
  sessionModels: Map<string, string>,
  entries: ModelEntry[],
  getDefault: () => string,
  debug: boolean,
): void {
  const original = (self["handleNewSession"] as (
    params: Record<string, unknown>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    conn: any,
  ) => Promise<Record<string, unknown>>).bind(self);

  self["handleNewSession"] = async (
    params: Record<string, unknown>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    conn: any,
  ): Promise<Record<string, unknown>> => {
    // Buffer session/update notifications that arrive before the response.
    // Each notification is shallow-copied to prevent deepagents-acp from
    // mutating the buffered object before setImmediate replays it.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const buffered: any[] = [];
    const proxyConn = new Proxy(conn, {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      get(target: any, prop: string) {
        if (prop === "sessionUpdate") {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (notification: any) => {
            // Shallow-copy to guard against mutation before replay.
            buffered.push({ ...notification });
            return Promise.resolve();
          };
        }
        return target[prop];
      },
    });

    const response = await original(params, proxyConn);
    const result = appendModelState(response, sessionModels, entries, getDefault);

    if (buffered.length > 0) {
      setImmediate(() => {
        for (const n of buffered) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (conn.sessionUpdate(n) as Promise<any>).catch((err: unknown) => {
            if (debug) {
              process.stderr.write(
                `[codai] Warning: failed to replay session/update notification: ` +
                  `${err instanceof Error ? err.message : String(err)}\n`,
              );
            }
          });
        }
      });
    }

    return result;
  };
}

export function patchLoadSession(
  self: AnyServer,
  sessionModels: Map<string, string>,
  entries: ModelEntry[],
  getDefault: () => string,
): void {
  const original = (self["handleLoadSession"] as (
    params: Record<string, unknown>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    conn: any,
  ) => Promise<Record<string, unknown>>).bind(self);

  self["handleLoadSession"] = async (
    params: Record<string, unknown>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    conn: any,
  ): Promise<Record<string, unknown>> => {
    const response = await original(params, conn);
    const sessionId = params["sessionId"] as string | undefined;
    return appendModelState(response, sessionModels, entries, getDefault, sessionId);
  };
}
