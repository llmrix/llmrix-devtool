/**
 * ACP auth-method builder.
 *
 * Maps provider config entries to the ACP ACPAuthMethod list advertised to
 * IDE clients at initialization. Kept in the providers package because it
 * directly describes provider identity, but the output type is ACP-protocol.
 */

import type { ACPAuthMethod } from "deepagents-acp";
import type { CopilotConfig } from "../config/index.js";

/**
 * Build the list of ACP auth methods advertised to clients at initialization.
 * All providers are advertised as agent-managed (pre-configured) since API keys
 * are stored directly in config.json, not sourced from environment variables.
 */
export function buildAuthMethods(config: CopilotConfig): ACPAuthMethod[] {
  return config.providers.map(
    (p) =>
      ({
        id: p.id,
        name: `${p.name} (pre-configured)`,
        type: "agent",
      }) satisfies ACPAuthMethod,
  );
}
