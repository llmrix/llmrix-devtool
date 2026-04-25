/**
 * CopilotServer — model-aware ACP server.
 *
 * Extends DeepAgentsServer with:
 *  - Multi-model selection (availableModels + model switching)
 *  - ACP spec-compliant sessionCapabilities
 *  - Active-provider auth method filtering
 *  - Error-to-chat conversion + configurable prompt timeout
 *  - session/update notification ordering fix (buffered Proxy)
 *
 * All behavioural changes are applied as targeted instance-level patches in
 * the constructor. Each patch is isolated in src/agent/patches/ so they can
 * be read, tested, and updated independently.
 */

import { DeepAgentsServer } from "deepagents-acp";
import type { CopilotConfig } from "../config/types.js";
import { buildModelEntries } from "../providers/model-utils.js";
import type { ModelEntry } from "../providers/model-utils.js";
import { patchInitialize, type AnyServer } from "./patches/patch-initialize.js";
import { patchPrompt } from "./patches/patch-prompt.js";
import { patchNewSession, patchLoadSession } from "./patches/patch-session.js";
import { patchModelSwitch } from "./patches/patch-model-switch.js";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface CopilotServerOptions {
  deepAgentsOptions: ConstructorParameters<typeof DeepAgentsServer>[0];
  config: CopilotConfig;
}

// Re-export for consumers (index.ts barrel)
export type { ModelEntry };

// ---------------------------------------------------------------------------
// CopilotServer
// ---------------------------------------------------------------------------

export class CopilotServer extends DeepAgentsServer {
  private readonly _config: CopilotConfig;
  private readonly _modelEntries: ModelEntry[];
  /** sessionId → currently selected "<providerId>:<modelName>" */
  private readonly _sessionModels = new Map<string, string>();
  private _cleanupTimer: ReturnType<typeof setInterval> | undefined;

  constructor(options: CopilotServerOptions) {
    super(options.deepAgentsOptions);
    this._config = options.config;
    this._modelEntries = buildModelEntries(options.config);

    this._assertInternalApi();

    const self = this as unknown as AnyServer;
    const entries = this._modelEntries;
    const sessionModels = this._sessionModels;
    const getDefault = () => `${this._config.provider}:${this._config.model}`;
    const timeoutMs = this._config.timeoutMs ?? 600_000;
    const debug = (options.deepAgentsOptions.debug ?? false) as boolean;

    patchInitialize(self, this._config.provider, entries.length > 0);
    patchPrompt(self, timeoutMs, debug);
    patchNewSession(self, sessionModels, entries, getDefault, debug);
    patchLoadSession(self, sessionModels, entries, getDefault);
    patchModelSwitch(self, this._config, sessionModels, entries, getDefault, debug);

    this._startSessionModelCleanup();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** Fail fast if deepagents-acp internal API has changed. */
  private _assertInternalApi(): void {
    const self = this as unknown as AnyServer;
    const required = [
      "sessions", "agentConfigs", "agents",
      "handleNewSession", "handleLoadSession", "handleInitialize",
      "handlePrompt", "createAgentHandler", "createAgent", "sendMessageChunk",
    ];
    const missing = required.filter((k) => !(k in self));
    if (missing.length > 0) {
      throw new Error(
        `deepagents-acp internal API mismatch — missing: ${missing.join(", ")}. ` +
          `Check the installed version of deepagents-acp.`,
      );
    }
  }

  /** Periodically evict _sessionModels entries for dead sessions. */
  private _startSessionModelCleanup(): void {
    const INTERVAL_MS = 5 * 60 * 1000;
    this._cleanupTimer = setInterval(() => {
      const alive = (this as unknown as AnyServer)["sessions"] as Map<string, unknown>;
      // Collect stale IDs first to avoid mutating the Map while iterating it.
      const stale = Array.from(this._sessionModels.keys()).filter((id) => !alive.has(id));
      for (const id of stale) this._sessionModels.delete(id);
    }, INTERVAL_MS);
    this._cleanupTimer.unref();
  }

  /** Stop the cleanup timer. Called automatically when the server stops. */
  override async stop(): Promise<void> {
    if (this._cleanupTimer !== undefined) {
      clearInterval(this._cleanupTimer);
      this._cleanupTimer = undefined;
    }
    await super.stop();
  }
}
