# llmrix-devtool

An AI coding assistant that runs as an [ACP](https://agentclientprotocol.com/) server over stdio. Works with **Zed**, **JetBrains IDEs**, and any other ACP-compatible client.

---

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [IDE Setup](#ide-setup)
- [Configuration](#configuration)
- [Slash Commands](#slash-commands)
- [Skills](#skills)
- [Memory](#memory)
- [File System Layout](#file-system-layout)
- [Development](#development)
- [Contributing](CONTRIBUTING.md)

---

## Features

- **Three modes** — Agent (autonomous execution), Plan (collaborative planning), Ask (Q&A only)
- **Multi-provider** — Anthropic, OpenAI, DeepSeek, Ollama, or any OpenAI-compatible endpoint
- **Dynamic model switching** — switch models from the IDE picker without restarting
- **Skills** — task-specific instruction sets (Global, Project, Hidden)
- **Memory** — project-level and personal knowledge (Global, Project, Hidden)

---

## Installation

```bash
npm install -g llmrix-devtool
```

Config is created automatically at `~/.llmrix/config/config.json` on first install. Set your API key there, then configure your IDE below.

> Or run without installing: `npx llmrix-devtool --help`

---

## IDE Setup

### Zed

Add to `settings.json` (`Zed: Open Settings`):

```json
{
  "agent_servers": {
    "llmrix-devtool": {
      "type": "custom",
      "command": "llmrix-devtool",
      "args": ["--config", "/Users/yourname/.config/llmrix/config.json"]
    }
  }
}
```

Then open the **Agent** panel → click **`+`** → select `llmrix-devtool`.

> Zed sets CWD to the project root automatically — no `--workspace` needed. Use an absolute path for `--config`; Zed does not expand `~`.

---

### JetBrains / IntelliJ

**1.** Install **AI Agent Client** from the JetBrains Marketplace.

**2.** Create or edit `~/.jetbrains/acp.json`:

```json
{
  "agent_servers": {
    "llmrix-devtool": {
      "type": "custom",
      "command": "llmrix-devtool",
      "args": ["--config", "/Users/yourname/.config/llmrix/config.json"],
      "env": {
        "WORKSPACE_ROOT": "$PROJECT_DIR$"
      }
    }
  }
}
```

**3.** Open the **AI Agent** panel from the right sidebar.

> Use an absolute path for `--config`. `$PROJECT_DIR$` expands to the current project root automatically.

#### Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| No server in agent panel | `acp.json` missing or invalid | Validate JSON; check `~/.jetbrains/acp.json` |
| "Agent not found" on first message | Wrong binary path | Use absolute path; verify with `which llmrix-devtool` |
| Model picker shows no models | `models` array empty | Add model names to each provider entry |
| `${API_KEY}` not resolved | Env var not in IDE environment | Set it in `"env"` inside `acp.json` |
| Messages time out silently | Server crash at startup | Add `"--debug"` to `args`; check `idea.log` |

---

## Configuration

Config file is read from the first location found:

| Priority | Source |
|----------|--------|
| 1 | `--config <path>` CLI flag |
| 2 | `LLMRIX_CONFIG` environment variable |
| 3 | `~/.llmrix/config/config.json` |
| 4 | `./config.json` (current directory) |
| 5 | Built-in defaults |

### config.json

```json
{
  "provider": "anthropic",
  "model": "claude-sonnet-4-6",
  "providers": [
    {
      "id": "anthropic",
      "name": "Anthropic",
      "protocol": "anthropic",
      "apiKey": "${ANTHROPIC_API_KEY}",
      "models": ["claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"]
    },
    {
      "id": "openai",
      "name": "OpenAI",
      "protocol": "openai",
      "apiKey": "${OPENAI_API_KEY}",
      "models": ["gpt-4o", "gpt-4o-mini", "o1", "o3-mini"]
    },
    {
      "id": "deepseek",
      "name": "DeepSeek",
      "protocol": "openai",
      "baseUrl": "https://api.deepseek.com/v1",
      "apiKey": "${DEEPSEEK_API_KEY}",
      "models": ["deepseek-chat", "deepseek-coder", "deepseek-reasoner"]
    },
    {
      "id": "ollama",
      "name": "Ollama (local)",
      "protocol": "openai",
      "baseUrl": "http://localhost:11434/v1",
      "apiKey": "ollama",
      "models": [
        "qwen2.5-coder:7b",
        "qwen2.5-coder:32b",
        "codellama:13b",
        "llama3.1:8b"
      ]
    }
  ]
}
```

#### Fields

| Field | Type | Description |
|-------|------|-------------|
| `provider` | `string` | Active provider — must match a `providers[].id` |
| `model` | `string` | Active model — must be listed in the active provider's `models` |
| `providers` | `array` | All available providers |

#### Provider fields

| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | Unique identifier |
| `name` | Yes | Display name shown in the IDE |
| `protocol` | Yes | `"anthropic"` or `"openai"` |
| `apiKey` | Yes | API key. Supports `${ENV_VAR}` placeholders |
| `baseUrl` | No | Custom endpoint — omit to use the official URL |
| `models` | Yes | Model names shown in the IDE model picker |

#### API key formats

```json
"apiKey": "${ANTHROPIC_API_KEY}"  // from environment variable (recommended)
"apiKey": "sk-ant-abc123..."      // hardcoded (not recommended)
"apiKey": ""                      // falls back to ANTHROPIC_API_KEY / OPENAI_API_KEY env vars
"apiKey": "ollama"                // for local Ollama (key is ignored)
```

#### Provider examples

<details>
<summary>DeepSeek</summary>

```json
{
  "id": "deepseek",
  "name": "DeepSeek",
  "protocol": "openai",
  "baseUrl": "https://api.deepseek.com/v1",
  "apiKey": "${DEEPSEEK_API_KEY}",
  "models": ["deepseek-chat", "deepseek-coder", "deepseek-reasoner"]
}
```
</details>

<details>
<summary>Ollama (local)</summary>

```json
{
  "id": "ollama",
  "name": "Ollama",
  "protocol": "openai",
  "baseUrl": "http://localhost:11434/v1",
  "apiKey": "ollama",
  "models": ["qwen2.5-coder:7b", "llama3.1:8b", "codellama:13b"]
}
```
</details>

<details>
<summary>Custom Anthropic-compatible gateway</summary>

```json
{
  "id": "my-gateway",
  "name": "My Gateway",
  "protocol": "anthropic",
  "baseUrl": "https://my-gateway.example.com/ai",
  "apiKey": "my-key",
  "models": ["claude-sonnet-4-6"]
}
```
</details>

### CLI options

```
llmrix-devtool [options]

  --config    <path>   Path to config.json
  --workspace <path>   Workspace root (default: current directory)
  --provider  <name>   Override active provider for this session
  --model     <name>   Override active model for this session
  --debug              Verbose logging to stderr
  --log-file  <path>   Write logs to file (implies --debug)
  --help, -h           Show help
  --version, -v        Show version

Environment variables:
  ANTHROPIC_API_KEY    Anthropic API key fallback
  OPENAI_API_KEY       OpenAI API key fallback
  LLMRIX_CONFIG         Config file path (alternative to --config)
  WORKSPACE_ROOT       Workspace root (alternative to --workspace)
```

---

## Slash Commands

| Command | Description |
|---------|-------------|
| `/agent` | Autonomous mode — AI plans and executes tasks using filesystem tools |
| `/plan` | Plan mode — builds a visible task plan before executing |
| `/ask` | Q&A mode — no tool calls or file edits |
| `/clear` | Clear conversation history |
| `/status` | Show current mode, provider, model, and session info |

---

## Skills

Skills are instruction sets that teach the agent domain-specific workflows. They are discovered automatically at startup and applied when a task matches the skill's description.

### Directory locations

| Priority | Path | Scope |
|----------|------|-------|
| 1 (higher) | `<workspace>/skills/` | Project-level |
| 2 | `<workspace>/.llmrix/skills/` | Project-level (hidden) |
| 3 | `~/.llmrix/skills/` | Global — all projects |

### Skill format

Each skill is a subdirectory containing a `SKILL.md`:

```
.llmrix/skills/
└── my-skill/
    ├── SKILL.md        ← required
    └── template.ts     ← optional supporting files
```

`SKILL.md` uses YAML front-matter:

```markdown
---
name: my-skill
description: One-line description — the agent uses this to decide when to apply the skill
---

Step-by-step instructions for the agent...
```

### How skills are used

1. At startup, llmrix-devtool reads every skill's `name` and `description` — no token cost.
2. When a task matches a skill, the full `SKILL.md` is read for instructions.
3. Supporting files in the skill directory are accessed on demand.

---

## Memory

Persistent context files loaded at the start of every session:

| Priority | Path | Scope |
|----------|------|-------|
| 1 (higher) | `<workspace>/AGENTS.md` | Project-level |
| 2 | `<workspace>/.llmrix/AGENTS.md` | Project-level (hidden) |
| 3 | `~/.llmrix/memory/AGENTS.md` | Global — all projects |

All files are concatenated and injected into the system prompt. Use them to store conventions, tech stack preferences, or anything the agent should always know.

Example `~/.llmrix/memory/AGENTS.md`:

```markdown
# My preferences

- Always use TypeScript strict mode
- Prefer async/await over callbacks
- Use pnpm, not npm
```

---

## File System Layout

```
~/.llmrix/
├── config/
│   └── config.json             ← provider / model config (auto-created on install)
├── memory/
│   └── AGENTS.md               ← global memory
├── skills/
│   └── <skill-name>/
│       └── SKILL.md            ← global skills
└── sessions/
    └── sessions.db             ← conversation history

<workspace>/
├── AGENTS.md                   ← project memory
├── skills/                     ← project skills (high priority)
│   └── <skill-name>/
│       └── SKILL.md
└── .llmrix/
    ├── AGENTS.md               ← project memory (team-shared)
    └── skills/                 ← project skills (low priority)
        └── <skill-name>/
            └── SKILL.md
```

---

## Development

```bash
git clone <repo>
cd llmrix-devtool
npm install

npm run dev -- --workspace /path/to/project --debug   # dev mode (no build needed)
npm run build                                          # compile
npm start -- --workspace /path/to/project             # run compiled binary
```

Detailed contributing guidelines can be found in [CONTRIBUTING.md](CONTRIBUTING.md).

---

## Acknowledgments

This project is built upon the excellent work of the **DeepAgents** team. We are grateful for their open-source contributions.
- [langchain-ai/deepagentsjs](https://github.com/langchain-ai/deepagentsjs)

---

## License

MIT
