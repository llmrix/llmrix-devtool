import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { FilesystemBackend } from "deepagents";
import { SystemMessage } from "@langchain/core/messages";
import type { CopilotConfig } from "./config/index.js";
import { createModel } from "./providers/model.js";
import { buildAuthMethods } from "./providers/auth.js";
import { CopilotServer } from "./agent/copilot-server.js";
import { createCheckpointer } from "./agent/checkpointer.js";
import {
  contextWindowMiddleware,
  toolOutputTruncationMiddleware,
  DEFAULT_MAX_MESSAGES,
  DEFAULT_MAX_TOOL_OUTPUT_LINES,
} from "./agent/middleware/index.js";
import { resolveWorkspaceRoot } from "./workspace/resolve.js";
import { initWorkspace } from "./workspace/init.js";
import {
  APP_NAME,
  APP_VERSION,
  GLOBAL_MEMORY_FILE,
  GLOBAL_SKILLS_DIR,
  WORKSPACE_DATA_DIR,
  WORKSPACE_AGENTS_FILE,
} from "./constants.js";

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
const STATIC_SYSTEM_PROMPT = `You are ${APP_NAME}, an AI developer assistant integrated into your IDE via the Agent Client Protocol (ACP).

## Operating modes

You have three modes activated with slash commands:

  /agent  - Autonomous Agent mode: independently plan and execute multi-step
            development tasks using all available tools (file read/write,
            shell execution, search). Use this for "just do it" requests.

  /plan   - Plan mode: collaboratively build a structured task plan before
            executing. The plan is shown in the IDE sidebar. Use this when
            the task is complex and you want to confirm the approach first.

  /ask    - Ask mode: conversational Q&A without executing any tools. Use
            this for explaining code, architecture discussions, and questions
            that don't require making changes.

Additional commands:
  /clear  - Clear the current conversation and start fresh
  /status - Show current mode, active provider/model, and session information

## Expertise

You are an expert in software engineering with deep knowledge of:
- Multiple programming languages (TypeScript, Python, Java, Go, Rust, etc.)
- Frameworks (React, Next.js, Spring Boot, FastAPI, etc.)
- Databases, DevOps, cloud infrastructure, and system design
- Code review, debugging, refactoring, and performance optimization

## Working guidelines

When working in Agent or Plan mode, always:
1. Read relevant files before making changes
2. Understand the existing code structure and patterns
3. Write clean, well-tested, idiomatic code consistent with the project style
4. Explain significant decisions in your responses`;

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
  return new SystemMessage({
    content: [
      {
        type: "text",
        text: STATIC_SYSTEM_PROMPT,
        // Marks this block as a Prompt Caching breakpoint for Anthropic.
        // After the first request the block is read from cache (~10% of the
        // normal input token cost) rather than being re-encoded.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        cache_control: { type: "ephemeral" } as any,
      },
      {
        type: "text",
        text: `\n\n## Current workspace\n\nYour active project directory is: ${workspaceRoot}\n\nAll file operations (read, write, search, shell commands) are scoped to this directory.\nWhen the user refers to "this project", "the current project", or "my code", they mean\nthe code under ${workspaceRoot}. Always start exploration from this root.`,
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
  const { config, debug = false } = options;
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
    path.join(workspaceRoot, "skills"),
    path.join(workspaceRoot, WORKSPACE_DATA_DIR, "skills"),
    GLOBAL_SKILLS_DIR,
  ];

  // Memory files to load (absolute paths)
  const memoryFiles: string[] = [
    GLOBAL_MEMORY_FILE,
    path.join(workspaceRoot, WORKSPACE_AGENTS_FILE),
    path.join(workspaceRoot, WORKSPACE_DATA_DIR, WORKSPACE_AGENTS_FILE),
  ];

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
      backend: new FilesystemBackend({ rootDir: workspaceRoot }),
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
          input: { hint: "Optional initial task description" },
        },
        {
          name: "plan",
          description:
            "Switch to Plan mode – collaboratively build a task plan shown in the IDE sidebar before execution.",
          input: { hint: "Optional task to plan" },
        },
        {
          name: "ask",
          description:
            "Switch to Ask mode – conversational Q&A without executing tools. Great for explaining code or discussing architecture.",
          input: { hint: "Your question" },
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
      ],
    },
  }});

  return server;
}
