#!/usr/bin/env node
/**
 * ${APP_NAME} CLI entry point
 *
 * Usage:
 *   ${APP_NAME} [options]
 *
 * Options:
 *   --config    <path>    Path to config.json
 *   --workspace <path>    Workspace root directory (default: CWD)
 *   --provider  <name>    Override the active provider (e.g. "anthropic", "openai")
 *   --model     <name>    Override the active model (e.g. "gpt-4o")
 *   --debug               Enable verbose debug logging to stderr
 *   --log-file  <path>    Write all debug logs to a file (implies debug)
 *   --help, -h            Show this help message
 *   --version, -v         Show version
 */

import { loadConfig } from "./config/index.js";
import { buildServer } from "./server.js";
import { resolveWorkspaceRoot, workspaceRootSource } from "./workspace/index.js";
import { APP_NAME, APP_VERSION, ENV_CONFIG_VAR } from "./constants.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function printHelp(): void {
  process.stderr.write(`
${APP_NAME} — AI developer assistant (Zed / IntelliJ ACP plugin)

Usage:
  ${APP_NAME} [options]

Options:
  --config    <path>    Path to a config.json file
  --workspace <path>    Workspace root directory (default: current directory)
  --provider  <name>    Provider override (e.g. "anthropic", "openai", "deepseek")
  --model     <name>    Model override (e.g. "claude-opus-4-6", "gpt-4o")
  --debug               Enable verbose debug logging to stderr
  --log-file  <path>    Write all debug logs to a file (useful for IntelliJ debugging)
  --help, -h            Print this help message and exit
  --version, -v         Print version and exit

Environment variables:
  ANTHROPIC_API_KEY    API key for the Anthropic provider
  OPENAI_API_KEY       API key for the OpenAI provider
  ${ENV_CONFIG_VAR}         Path to config.json (alternative to --config)

Config file resolution order (first found wins):
  1. --config <path>
  2. ${ENV_CONFIG_VAR} env var
  3. ~/.config/${APP_NAME}/config.json
  4. ./config.json (current directory)
  5. Built-in defaults

Slash commands (inside IDE chat):
  /agent   Autonomous execution mode
  /plan    Collaborative planning mode
  /ask     Q&A mode (no tool calls)
  /clear   Clear conversation
  /status  Show current session status
`);
}

function printVersion(): void {
  process.stderr.write(`${APP_NAME} v${APP_VERSION}\n`);
}

// ---------------------------------------------------------------------------
// CLI argument parser
// ---------------------------------------------------------------------------

interface CliArgs {
  configPath?: string;
  workspaceRoot?: string;
  provider?: string;
  model?: string;
  debug: boolean;
  logFile?: string;
  help: boolean;
  version: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    debug: false,
    help: false,
    version: false,
  };

  // Options that require a following value argument
  const valueOptions = new Set(["--config", "--workspace", "--provider", "--model", "--log-file"]);

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];

    if (valueOptions.has(arg)) {
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        process.stderr.write(`[${APP_NAME}] Error: "${arg}" requires a value\n`);
        process.exit(1);
      }
      switch (arg) {
        case "--config":    args.configPath    = next; break;
        case "--workspace": args.workspaceRoot = next; break;
        case "--provider":  args.provider      = next; break;
        case "--model":     args.model         = next; break;
        case "--log-file":
          args.logFile = next;
          args.debug = true; // log-file implies debug
          break;
      }
      i += 2;
      continue;
    }

    switch (arg) {
      case "--debug":
        args.debug = true;
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
      case "--version":
      case "-v":
        args.version = true;
        break;
      default:
        if (arg && !arg.startsWith("--")) {
          // Positional args are ignored for now
        } else if (arg) {
          process.stderr.write(
            `[${APP_NAME}] Warning: unknown option "${arg}"\n`
          );
        }
    }

    i++;
  }

  return args;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // Skip node and script path
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (args.version) {
    printVersion();
    process.exit(0);
  }

  // Load configuration
  let config = loadConfig(args.configPath);

  // Apply CLI overrides
  if (args.provider) {
    config = { ...config, provider: args.provider };
  }
  if (args.model) {
    config = { ...config, model: args.model };
  }

  if (args.debug) {
    process.stderr.write(
      `[${APP_NAME}] Starting with provider="${config.provider}" model="${config.model}"\n`
    );
  }

  // Resolve workspace root (--workspace flag → WORKSPACE_ROOT env → CWD)
  const workspaceRoot = resolveWorkspaceRoot(args.workspaceRoot);

  if (args.debug) {
    process.stderr.write(
      `[${APP_NAME}] Workspace root: ${workspaceRoot} (source: ${workspaceRootSource(args.workspaceRoot)})\n`
    );
  }

  // Build and start server
  try {
    const server = await buildServer({
      config,
      workspaceRoot,
      provider: args.provider,
      model: args.model,
      debug: args.debug,
      logFile: args.logFile,
    });

    // Graceful shutdown on termination signals — guard against concurrent signals
    let shuttingDown = false;
    const shutdown = async (signal: string) => {
      if (shuttingDown) return;
      shuttingDown = true;
      if (args.debug) {
        process.stderr.write(`[${APP_NAME}] Received ${signal}, shutting down...\n`);
      }
      try {
        await server.stop();
      } catch {
        // Ignore errors during shutdown
      }
      process.exit(0);
    };

    process.on("SIGINT", () => { void shutdown("SIGINT"); });
    process.on("SIGTERM", () => { void shutdown("SIGTERM"); });

    await server.start();
    // stdin closed → frontend disconnected; exit cleanly so the process does not hang
    process.exit(0);
  } catch (err) {
    process.stderr.write(
      `[${APP_NAME}] Fatal error: ${err instanceof Error ? err.message : String(err)}\n`
    );
    if (args.debug && err instanceof Error && err.stack) {
      process.stderr.write(err.stack + "\n");
    }
    process.exit(1);
  }
}

await main();
