/**
 * Patch: handleInitialize
 *
 * Fixes two ACP spec non-conformances in deepagents-acp's default response:
 *
 *  1. Auth method filtering — deepagents-acp advertises ALL configured auth
 *     methods; we reduce this to the single active provider so the IDE only
 *     shows one entry.
 *
 *  2. sessionCapabilities shape — deepagents-acp sends `{ modes: true,
 *     commands: true }` which is not ACP-spec. Replace with `{}` and
 *     optionally add the `unstable_setSessionModel` capability flag when
 *     model entries are available.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyServer = Record<string, any>;

export function patchInitialize(
  self: AnyServer,
  activeProvider: string,
  hasModels: boolean,
): void {
  const original = (self["handleInitialize"] as (
    params: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>).bind(self);

  self["handleInitialize"] = async (
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const response = await original(params);

    // Fix 1: only expose the auth method for the active provider
    const authMethods = response["authMethods"] as
      | Array<Record<string, unknown>>
      | undefined;
    let fixedAuthMethods: Array<Record<string, unknown>> | undefined;
    if (authMethods?.length) {
      const active =
        authMethods.find((m) => m["id"] === activeProvider) ??
        ({ id: activeProvider, name: `${activeProvider} (configured)`, type: "agent" } as Record<string, unknown>);
      fixedAuthMethods = [active];
    }

    // Fix 2: replace non-standard sessionCapabilities with ACP-spec structure
    const agentCaps = response["agentCapabilities"] as
      | Record<string, unknown>
      | undefined;
    const fixedAgentCaps = agentCaps
      ? {
          ...agentCaps,
          sessionCapabilities: {},
          ...(hasModels ? { unstable_setSessionModel: {} } : {}),
        }
      : agentCaps;

    return {
      ...response,
      ...(fixedAuthMethods ? { authMethods: fixedAuthMethods } : {}),
      ...(fixedAgentCaps ? { agentCapabilities: fixedAgentCaps } : {}),
    };
  };
}
