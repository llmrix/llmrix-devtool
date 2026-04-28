#!/usr/bin/env node
/**
 * dev-repl.mjs — ACP stdio development REPL
 *
 * Spawns the devtool-copilot server as a child process and drives it with
 * real ACP ndjson messages, letting you chat with the agent from the terminal
 * without needing an IDE.
 *
 * Usage:
 *   node scripts/dev-repl.mjs [--workspace <path>] [--debug]
 *
 * The script automatically:
 *   1. Spawns:  tsx src/cli.ts --debug [--workspace <path>]
 *   2. Sends:   initialize → session/new → session/prompt (interactive loop)
 *   3. Prints:  server responses (text chunks + tool calls) to stdout
 *   4. Reads:   user input from stdin (readline)
 */

import { spawn } from "node:child_process";
import * as readline from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const workspaceIdx = argv.indexOf("--workspace");
const workspace = workspaceIdx !== -1 ? argv[workspaceIdx + 1] : root;
const debugMode = argv.includes("--debug");

// ---------------------------------------------------------------------------
// ndjson helpers
// ---------------------------------------------------------------------------

let _msgId = 1;
function nextId() { return _msgId++; }

function makeRequest(method, params) {
  return JSON.stringify({ jsonrpc: "2.0", id: nextId(), method, params }) + "\n";
}

function makeNotification(method, params) {
  return JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n";
}

// ---------------------------------------------------------------------------
// Spawn server
// ---------------------------------------------------------------------------

const serverArgs = [
  "src/cli.ts",
  "--workspace", workspace,
  "--debug",
];

console.error(`\x1b[2m[repl] spawning: tsx ${serverArgs.join(" ")}\x1b[0m`);

const server = spawn("npx", ["tsx", ...serverArgs], {
  cwd: root,
  stdio: ["pipe", "pipe", "inherit"], // stdin/stdout piped, stderr inherited
  env: { ...process.env },
});

server.on("error", (err) => {
  console.error(`[repl] failed to start server: ${err.message}`);
  process.exit(1);
});

server.on("exit", (code) => {
  console.error(`\n[repl] server exited (code ${code})`);
  process.exit(code ?? 0);
});

// ---------------------------------------------------------------------------
// Response parser — buffer ndjson lines from server stdout
// ---------------------------------------------------------------------------

let _sessionId = null;
let _pendingResolve = null;
let _textBuffer = "";

function handleServerMessage(line) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    if (debugMode) console.error(`[repl] non-json from server: ${line}`);
    return;
  }

  // Notification (no id) — streaming chunk
  if (msg.method) {
    const p = msg.params ?? {};

    if (msg.method === "session/message_chunk") {
      const content = p.content ?? [];
      for (const block of content) {
        if (block.type === "text") {
          process.stdout.write(block.text);
          _textBuffer += block.text;
        }
      }
      return;
    }

    if (msg.method === "session/tool_call") {
      const tc = p.toolCall ?? {};
      process.stdout.write(`\x1b[2m  [tool: ${tc.name ?? "?"} ${JSON.stringify(tc.args ?? {}).slice(0, 80)}]\x1b[0m\n`);
      return;
    }

    if (msg.method === "session/message_complete") {
      if (_textBuffer) process.stdout.write("\n");
      _textBuffer = "";
      if (_pendingResolve) { _pendingResolve(); _pendingResolve = null; }
      return;
    }

    if (debugMode) console.error(`[repl] notification: ${msg.method}`);
    return;
  }

  // Response (has id)
  if (msg.id !== undefined) {
    if (msg.error) {
      console.error(`\n[repl] error response: ${JSON.stringify(msg.error)}`);
      if (_pendingResolve) { _pendingResolve(); _pendingResolve = null; }
      return;
    }

    const result = msg.result ?? {};

    // session/new response — capture sessionId
    if (result.sessionId) {
      _sessionId = result.sessionId;
      if (debugMode) console.error(`[repl] session created: ${_sessionId}`);
    }

    if (_pendingResolve) { _pendingResolve(); _pendingResolve = null; }
  }
}

// Buffer incomplete lines across chunks
let _lineBuffer = "";
server.stdout.on("data", (chunk) => {
  _lineBuffer += chunk.toString("utf-8");
  const lines = _lineBuffer.split("\n");
  _lineBuffer = lines.pop() ?? ""; // last element may be incomplete
  for (const line of lines) {
    if (line.trim()) handleServerMessage(line.trim());
  }
});

// ---------------------------------------------------------------------------
// Send helpers (returns promise that resolves when server signals completion)
// ---------------------------------------------------------------------------

function send(msg) {
  return new Promise((resolve) => {
    _pendingResolve = resolve;
    server.stdin.write(msg);
    // Fallback timeout in case server never sends message_complete
    setTimeout(() => { if (_pendingResolve) { _pendingResolve = null; resolve(); } }, 30_000);
  });
}

function sendNoWait(msg) {
  server.stdin.write(msg);
}

// ---------------------------------------------------------------------------
// Handshake: initialize → session/new
// ---------------------------------------------------------------------------

async function handshake() {
  // 1. initialize
  await send(makeRequest("initialize", {
    protocolVersion: "2025-03-26",
    clientInfo: { name: "dev-repl", version: "0.0.5" },
    capabilities: {},
  }));

  // 2. session/new
  await send(makeRequest("session/new", {
    agentName: "devtool-copilot",
  }));

  if (!_sessionId) {
    console.error("[repl] ERROR: no sessionId received after session/new");
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Interactive prompt loop
// ---------------------------------------------------------------------------

async function promptLoop() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr, // prompt goes to stderr so stdout stays clean
    terminal: true,
  });

  const ask = () =>
    new Promise((resolve) => {
      rl.question("\x1b[36mYou>\x1b[0m ", resolve);
    });

  console.error(`\n\x1b[32m[repl] connected — workspace: ${workspace}\x1b[0m`);
  console.error(`\x1b[2mType your message, or Ctrl+C to exit.\x1b[0m\n`);

  while (true) {
    let input;
    try {
      input = await ask();
    } catch {
      break; // Ctrl+C / EOF
    }

    if (!input.trim()) continue;
    if (input.trim() === "/exit" || input.trim() === "/quit") break;

    process.stderr.write(`\x1b[35mAgent>\x1b[0m `);

    await send(makeRequest("session/prompt", {
      sessionId: _sessionId,
      content: [{ type: "text", text: input }],
    }));
  }

  rl.close();
  server.stdin.end();
  console.error("\n[repl] bye.");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

// Give the server a moment to boot before sending initialize
await new Promise((r) => setTimeout(r, 500));

await handshake();
await promptLoop();
