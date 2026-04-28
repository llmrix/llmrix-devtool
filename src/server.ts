import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import {LocalShellBackend} from "deepagents";
import {SystemMessage} from "@langchain/core/messages";
import type {CopilotConfig} from "./config/index.js";
import {createModel} from "./providers/model.js";
import {buildAuthMethods} from "./providers/auth.js";
import {CopilotServer} from "./agent/copilot-server.js";
import {createCheckpointer} from "./agent/checkpointer.js";
import {
    contextWindowMiddleware,
    toolOutputTruncationMiddleware,
    DEFAULT_MAX_MESSAGES,
    DEFAULT_MAX_TOOL_OUTPUT_LINES,
} from "./agent/middleware/index.js";
import {resolveWorkspaceRoot} from "./workspace/resolve.js";
import {initWorkspace} from "./workspace/init.js";
import {
    APP_NAME,
    APP_VERSION,
    GLOBAL_MEMORY_FILE,
    GLOBAL_SKILLS_DIR,
    WORKSPACE_DATA_DIR,
    WORKSPACE_SKILLS_DIR,
    WORKSPACE_AGENTS_FILE,
} from "./constants.js";
import {McpManager} from "./utils/mcp.js";

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

/**
 * Static portion of the system prompt — content that never changes between
 * requests or even between sessions. Tagged with `cache_control: ephemeral`
 * so Anthropic's prompt caching can reuse it after the first request.
 *
 * Kept as a module-level constant so the string is allocated once.
 */
const STATIC_SYSTEM_PROMPT = `You are ${APP_NAME}, a world-class AI developer assistant integrated into the user's IDE via the Agent Client Protocol (ACP).

## Communication Style (CRITICAL)
- DO NOT use polite filler words (e.g., "Certainly!", "I can help with that", "Here is the code").
- Be exceedingly concise and direct. Answer immediately.
- Never output block comments containing \`...\` or \`// existing code\`. If you write a function or make changes, provide the complete, functional code block.

## Operating modes

- /agent  : Autonomous mode. Use tools directly. Before acting, use a <thinking> block to plan your next steps, then execute.
- /plan   : Collaborative mode. Draft a step-by-step markdown plan. Do not execute tools until the user approves.
- /ask    : Q&A mode. Discuss architecture and explain concepts. Do not use tools.

Additional commands:
  /clear  - Clear the current conversation and start fresh
  /status - Show current session information

## Expertise & Coding Guidelines
- You are an expert software engineer. Write clean, production-ready, idiomatic code. Handle edge cases.
- Follow the exact stylistic conventions found in the current workspace.
- Always read relevant files before making assumptions or changes.
- If you encounter an error after running a shell command or tests, analyze the error explicitly before trying a fix.
- SAFETY WARNING: Before executing destructive operations (like \`rm -rf\` on critical directories) or drastically modifying core config files, explicitly warn the user if operating in an uncertain context.`;

/**
 * Build a `SystemMessage` whose static content is tagged for prompt caching.
 *
 * Two content blocks are used:
 *  1. Static block (cacheable) — modes, expertise, guidelines.  Tagged with
 *     `cache_control: { type: "ephemeral" }` so Anthropic reuses the KV
 *     cache entry across requests instead of re-encoding it every time.
 *  2. Dynamic block — workspace path that differs per project.  Not tagged,
 *     so it is always re-encoded (it changes per workspace).
 *
 * Providers that don't support prompt caching (e.g. OpenAI) ignore the
 * `cache_control` annotation and behave as before.
 */
function buildSystemPrompt(workspaceRoot: string): SystemMessage {
    const platform = os.platform(); // 'darwin', 'win32', 'linux'
    const isWindows = platform === "win32";

    return new SystemMessage({
        content: [
            {
                type: "text",
                text: STATIC_SYSTEM_PROMPT,
                // Marks this block as a Prompt Caching breakpoint for Anthropic.
                // After the first request the block is read from cache (~10% of the
                // normal input token cost) rather than being re-encoded.
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                cache_control: {type: "ephemeral"} as any,
            },
            {
                type: "text",
                text: `\n\n## Environment information\n\nOperating System: ${platform} (${os.release()})\nActive workspace: ${workspaceRoot}\n\nAll file operations (read, write, search, shell commands) are scoped to this directory.\nWhen the user refers to "this project", "the current project", or "my code", they mean\nthe code under ${workspaceRoot}. Always start exploration from this root.\n\n${
                    isWindows
                        ? "You are running on Windows. Use Windows-compatible shell commands (e.g., `dir` instead of `ls` if using cmd, or ensure PowerShell compatibility) and backslash path separators where appropriate."
                        : "You are running on a Unix-like system. Use standard POSIX shell commands and forward slash path separators."
                }`,
            },
        ],
    });
}

// ---------------------------------------------------------------------------
// Server builder
// ---------------------------------------------------------------------------

/** Options for configuring the ${APP_NAME} ACP server. */
export interface ServerOptions {
    config: CopilotConfig;
    /** Workspace root directory (defaults to CWD) */
    workspaceRoot?: string;
    /** Provider name override (overrides config.provider) */
    provider?: string;
    /** Model name override (overrides config.model) */
    model?: string;
    /** Enable debug logging to stderr */
    debug?: boolean;
    /** Write all debug logs to this file path */
    logFile?: string;
}

/**
 * Build and return a configured `DeepAgentsServer` instance.
 *
 * The server communicates over stdio (stdin/stdout) and is ready to be
 * started by calling `.start()`.
 */
export async function buildServer(options: ServerOptions): Promise<CopilotServer> {
    const {config, debug = false} = options;
    const workspaceRoot = resolveWorkspaceRoot(options.workspaceRoot);

    // Validate workspace exists and is a directory before doing anything else.
    try {
        const stat = fs.statSync(workspaceRoot);
        if (!stat.isDirectory()) {
            throw new Error(`Workspace path is not a directory: "${workspaceRoot}"`);
        }
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
            throw new Error(`Workspace directory does not exist: "${workspaceRoot}"`);
        }
        throw err;
    }

    const providerName = options.provider ?? config.provider;
    const modelName = options.model ?? config.model;

    // Initialize MCP Manager and fetch external tools
    const mcpManager = new McpManager();
    if (config.mcpServers) {
        await mcpManager.connectAll(config.mcpServers);
    }
    const mcpTools = await mcpManager.getAllTools();

    // Ensure workspace skeleton exists
    initWorkspace(workspaceRoot);

    // Instantiate the LangGraph SQLite checkpoint saver
    const checkpointer = createCheckpointer();

    // Instantiate the LangChain model.
    // Pass timeoutMs so the SDK-level HTTP socket is closed on timeout,
    // matching the application-layer timeout in patch-prompt.ts.
    const chatModel = await createModel(config, providerName, modelName, config.timeoutMs);

    // Build auth methods from all configured providers
    const authMethods = buildAuthMethods(config);

    // Skill source directories (absolute paths).
    // buildCachedSkillSources keeps a process-level mtime cache so that
    // repeated createAgent calls (triggered by model switches) do not scan the
    // filesystem on every rebuild.
    const skillSources = [
        path.join(workspaceRoot, WORKSPACE_SKILLS_DIR), // 1. Project-level (hidden)
        GLOBAL_SKILLS_DIR,                             // 2. Global-level
    ];

    // Memory files to load (absolute paths)
    const memoryFiles: string[] = [
        path.join(workspaceRoot, WORKSPACE_AGENTS_FILE), // 1. Project-level (hidden)
        GLOBAL_MEMORY_FILE,                             // 2. Global-level
    ];

    // LocalShellBackend inherits all FilesystemBackend file operations and
    // additionally exposes an `execute()` method via child_process.spawn,
    // which is required for the agent's shell-execution tool to function.
    // FilesystemBackend alone has no `execute()`, so the framework silently
    // drops the tool — causing "permission denied" / "execution not available"
    // errors inside the IDE.
    const shellBackend = await LocalShellBackend.create({
        rootDir: workspaceRoot,
        inheritEnv: true,   // inherit PATH, HOME, etc. from the parent process
        timeout: 120,       // 2-minute command timeout (seconds)
    });

    const server = new CopilotServer({
        config,
        deepAgentsOptions: {
            serverName: APP_NAME,
            serverVersion: APP_VERSION,
            workspaceRoot,
            debug,
            logFile: options.logFile,
            authMethods,
            agents: {
                name: APP_NAME,
                description:
                    "AI developer assistant with Agent/Plan/Ask modes. Supports filesystem access, code editing, and shell execution within your workspace.",
                model: chatModel,
                systemPrompt: buildSystemPrompt(workspaceRoot),
                backend: shellBackend,
                checkpointer,
                interruptOn: {
                    execute: true,
                },
                skills: skillSources,
                memory: memoryFiles,
                // Token optimisation middleware (applied in this order before the agent runs):
                //  1. Context window trim — evicts oldest messages when history exceeds
                //     maxMessages, keeping the built-in SummarizationMiddleware's input
                //     small and reducing per-request token cost.
                //  2. Tool output truncation — caps individual tool results to
                //     maxToolOutputLines lines so a single large file read cannot exhaust
                //     the remaining context budget.
                middleware: [
                    contextWindowMiddleware({
                        maxMessages: config.maxMessages ?? DEFAULT_MAX_MESSAGES,
                    }),
                    toolOutputTruncationMiddleware({
                        maxLines: config.maxToolOutputLines ?? DEFAULT_MAX_TOOL_OUTPUT_LINES,
                    }),
                ],
                commands: [
                    {
                        name: "agent",
                        description:
                            "Switch to autonomous Agent mode – the AI will independently plan and execute tasks using all available tools.",
                        input: {hint: "Optional initial task description"},
                    },
                    {
                        name: "plan",
                        description:
                            "Switch to Plan mode – collaboratively build a task plan shown in the IDE sidebar before execution.",
                        input: {hint: "Optional task to plan"},
                    },
                    {
                        name: "ask",
                        description:
                            "Switch to Ask mode – conversational Q&A without executing tools. Great for explaining code or discussing architecture.",
                        input: {hint: "Your question"},
                    },
                    {
                        name: "clear",
                        description: "Clear the current conversation and start a new session.",
                    },
                    {
                        name: "status",
                        description:
                            "Show current mode, active provider/model, and session information.",
                    },
                    {
                        name: "mcp",
                        description: "List connected MCP servers and their available tools.",
                    },
                ],
                // Inject dynamically discovered MCP tools
                tools: mcpTools,
            },
        },
        mcpManager,
    });

    return server;
}
