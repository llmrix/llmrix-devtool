/**
 * Public re-export barrel for codai.
 *
 * Consumers can import everything from a single entry point:
 *
 *   import { loadConfig, buildServer, createModel } from "codai";
 */

// Config
export { loadConfig, type CopilotConfig, type ProviderConfig } from "./config/index.js";

// Provider factory
export { createModel } from "./providers/model.js";
export { buildAuthMethods } from "./providers/auth.js";

// Server builder
export { buildServer, type ServerOptions } from "./server.js";

// Model-aware ACP server
export {
  CopilotServer,
  buildModelEntries,
  type CopilotServerOptions,
  type ModelEntry,
} from "./agent/index.js";

