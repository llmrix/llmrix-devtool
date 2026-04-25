/**
 * Patch: model switching handlers
 *
 * Injects two ACP model-switching protocol handlers into the agent handler
 * object returned by `createAgentHandler`:
 *
 *  - `setSessionConfigOption` (id:"model") — used by Zed and other clients
 *  - `unstable_setSessionModel`             — used by IntelliJ ACP plugin
 *
 * Also handles `setSessionConfigOption` with id:"mode" by delegating to the
 * existing `handleSetSessionMode` handler already present in deepagents-acp.
 */

import type { ModelEntry } from "../../utils/model.js";
import { parseModelValue } from "../../utils/model.js";
import { appendModelState } from "./patch-session.js";
import { createModel } from "../../providers/model.js";
import type { CopilotConfig } from "../../config/types.js";
import type { AnyServer } from "./patch-initialize.js";

export function patchModelSwitch(
  self: AnyServer,
  config: CopilotConfig,
  sessionModels: Map<string, string>,
  entries: ModelEntry[],
  getDefault: () => string,
  debug: boolean,
): void {
  // Per-session mutex: each sessionId maps to the tail of its promise chain.
  // This ensures concurrent model-switch requests for the same session are
  // serialised and cannot interleave during the async createModel() call.
  const switchQueue = new Map<string, Promise<void>>();
  const originalCreateAgentHandler = (self["createAgentHandler"] as (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    conn: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ) => Record<string, any>).bind(self);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  self["createAgentHandler"] = (conn: any): Record<string, any> => {
    const agent = originalCreateAgentHandler(conn);

    // Helper: rebuild config-option response for current session state
    const buildResponse = (sessionId: string): Record<string, unknown> => {
      const currentModelId = sessionModels.get(sessionId) ?? getDefault();
      const sessions: Map<string, { mode?: string }> = self["sessions"];
      const currentModeId = sessions.get(sessionId)?.["mode"] ?? "agent";

      return {
        configOptions: [
          {
            id: "mode",
            name: "Mode",
            category: "mode",
            type: "select",
            currentValue: currentModeId,
            options: [
              { value: "agent", name: "Agent", description: "Autonomous execution with tools" },
              { value: "plan",  name: "Plan",  description: "Collaborative planning before execution" },
              { value: "ask",   name: "Ask",   description: "Q&A only, no tool calls" },
            ],
          },
          {
            id: "model",
            name: "Model",
            category: "model",
            type: "select",
            currentValue: currentModelId,
            options: entries.map((e) => ({
              value: e.value,
              name: e.name,
              description: e.description ?? null,
            })),
          },
        ],
      };
    };

    // Helper: recreate the DeepAgents agent with the new model.
    // Serialised per sessionId to prevent concurrent switches from racing
    // during the async createModel() call.
    const applySwitch = (sessionId: string, modelValue: string, conn: unknown): Promise<void> => {
      const tail = (switchQueue.get(sessionId) ?? Promise.resolve()).then(async () => {
        const parsed = parseModelValue(modelValue);
        if (!parsed) {
          process.stderr.write(
            `[codai] Warning: ignoring model switch — ` +
              `invalid value "${modelValue}" (expected "providerId:modelName")\n`,
          );
          return;
        }

        const chatModel = await createModel(
          config,
          parsed.providerId,
          parsed.modelName,
          config.timeoutMs,
        );

        const sessions: Map<string, { agentName: string }> = self["sessions"];
        const agentConfigs: Map<string, { model: unknown }> = self["agentConfigs"];
        const agents: Map<string, unknown> = self["agents"];

        const session = sessions.get(sessionId);
        if (!session) return;

        const agentConfig = agentConfigs.get(session.agentName);
        if (agentConfig) agentConfig.model = chatModel;

        agents.delete(session.agentName);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (self["createAgent"] as (name: string) => void)(session.agentName);

        if (debug) {
          process.stderr.write(
            `[codai] Model switched to "${modelValue}" for session ${sessionId}\n`,
          );
        }
      });

      // Keep the queue alive on error, and surface the failure as a chat message.
      const guarded = tail.catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[codai] Model switch failed: ${msg}\n`);
        // Best-effort: send visible error into the chat for this session.
        void (self["sendMessageChunk"] as Function)(sessionId, conn, "agent", [
          { type: "text", text: `⚠️ **Model switch failed:** ${msg}` },
        ]).catch(() => {});
      });
      switchQueue.set(sessionId, guarded);
      return tail;
    };

    // ── session/set_config_option (Zed / fallback) ──────────────────────────
    agent["setSessionConfigOption"] = async (params: Record<string, unknown>) => {
      const sessionId = params["sessionId"] as string;
      const configId  = params["configId"]  as string;
      const value     = params["value"]     as string;

      if (configId === "mode") {
        await (self["handleSetSessionMode"] as Function)({ sessionId, mode: value });
        return buildResponse(sessionId);
      }

      if (configId === "model") {
        if (!entries.some((e) => e.value === value)) {
          throw new Error(
            `Invalid model: "${value}". Available: ${entries.map((e) => e.value).join(", ")}`,
          );
        }
        sessionModels.set(sessionId, value);
        await applySwitch(sessionId, value, conn);
        return buildResponse(sessionId);
      }

      throw new Error(
        `Unknown configId: "${configId}". Supported: "mode", "model".`,
      );
    };

    // ── session/set_model (IntelliJ ACP plugin) ─────────────────────────────
    agent["unstable_setSessionModel"] = async (params: Record<string, unknown>) => {
      const sessionId = params["sessionId"] as string;
      const modelId   = params["modelId"]   as string;

      if (!entries.some((e) => e.value === modelId)) {
        throw new Error(
          `Invalid model: "${modelId}". Available: ${entries.map((e) => e.value).join(", ")}`,
        );
      }

      sessionModels.set(sessionId, modelId);
      await applySwitch(sessionId, modelId, conn);
      return {};
    };

    return agent;
  };
}
