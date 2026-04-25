# Plugin Build & Distribution Guide

This document explains how to build `devtool-copilot`, install it locally in Zed and IntelliJ, and publish it to the Zed Extension Marketplace and npm.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Building the Plugin](#building-the-plugin)
- [Local Installation](#local-installation)
  - [Install as a Global npm Binary](#install-as-a-global-npm-binary)
  - [Zed — Local Dev Extension](#zed--local-dev-extension)
  - [IntelliJ — Local Binary](#intellij--local-binary)
- [Publishing to npm](#publishing-to-npm)
- [Publishing to the Zed Extension Marketplace](#publishing-to-the-zed-extension-marketplace)
  - [1. Create the Zed Extension Repository](#1-create-the-zed-extension-repository)
  - [2. Write extension.toml](#2-write-extensiontoml)
  - [3. Test Locally with Zed Dev Extension](#3-test-locally-with-zed-dev-extension)
  - [4. Submit a PR to zed-industries/extensions](#4-submit-a-pr-to-zed-industriesextensions)
- [Distribution Checklist](#distribution-checklist)

---

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | ≥ 20 | Runtime |
| npm | ≥ 10 | Package manager / publishing |
| TypeScript | bundled via devDep | Build |
| Rust + `rustup` | latest stable | Required for Zed extension compilation (WASM) |
| Zed | latest | Testing the extension locally |

Install Rust (required by the Zed extension toolchain):

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

---

## Building the Plugin

```bash
# 1. Install dependencies
npm install

# 2. Compile TypeScript → dist/
npm run build

# Verify the binary entry point was emitted
node dist/cli.js --version
```

The `build` script runs `tsc`, which outputs compiled files to `dist/` according to `tsconfig.json` (`target: ES2022`, `module: NodeNext`).

To run without a build step during development:

```bash
npm run dev -- --workspace /path/to/project --debug
# expands to: tsx src/cli.ts --workspace /path/to/project --debug
```

---

## Local Installation

### Install as a Global npm Binary

After building, link the binary so it is available system-wide:

```bash
# Option A — npm global install from local directory
npm install -g .

# Verify
devtool-copilot --version

# Option B — npm link (symlink, easier to update during development)
npm link
devtool-copilot --version
```

To uninstall later:

```bash
npm uninstall -g devtool-copilot
# or
npm unlink
```

---

### Zed — Local Dev Extension

Zed supports loading an unpublished extension directly from disk. This is the fastest way to test the ACP integration.

> The Zed ACP integration is configured via `settings.json`, not through the Zed extension system. Use the steps below to wire up the binary as an ACP agent profile.

**Step 1 — Open Zed settings**

Press `Cmd+,` (macOS) or `Ctrl+,` (Linux) and click **Open settings.json**.

**Step 2 — Add the agent configuration**

```json
{
  "agent_servers": {
    "devtool-copilot": {
      "type": "custom",
      "command": "/usr/local/bin/devtool-copilot",
      "args": ["--config", "~/.config/devtool-copilot/config.json"]
    }
  }
}
```

Replace `/usr/local/bin/devtool-copilot` with the output of `which devtool-copilot`.

Zed 启动进程时会自动将 CWD 设为当前工程根目录，**切换工程无需修改配置**。无需设置 `WORKSPACE_ROOT` 环境变量（Zed 不会展开 `${workspaceFolder}` 变量）。

> **不使用 config 文件时**，在 `env` 里追加 API Key：
>
> ```json
> "env": {
>   "ANTHROPIC_API_KEY": "sk-ant-..."
> }
> ```

**Step 3 — Open the Agent panel and select the agent**

1. 点击底部状态栏 **✨ 图标**，或命令面板输入 `agent: new thread`
2. 面板右上角点击 **`+` 按钮**
3. 在 **External Agents** 列表中选择 **devtool-copilot**

Zed 会自动启动 binary 进程并通过 stdio 建立连接。

**Step 4 — Verify modes**

Type `/agent`, `/plan`, or `/ask` in the chat input to switch modes. Use `/status` to confirm the session is running.

---

### IntelliJ — Local Binary

IntelliJ and other JetBrains IDEs use the same stdio binary through the **AI Agent** plugin.

**Step 1 — Install the AI Agent plugin**

Open **Settings → Plugins → Marketplace**, search for **"AI Agent"** (by JetBrains), and install it. Restart the IDE.

**Step 2 — Configure the agent**

Go to **Settings → Tools → AI Agent**.

Click **+** to add a new agent and fill in:

| Field | Value |
|-------|-------|
| Name | `devtool-copilot` |
| Command | `/usr/local/bin/devtool-copilot` (or output of `which devtool-copilot`) |
| Arguments | `--config ~/.config/devtool-copilot/config.json` |
| Working directory | `$PROJECT_DIR$` |
| Environment | `WORKSPACE_ROOT=$PROJECT_DIR$` |
| Environment | `ANTHROPIC_API_KEY=sk-ant-...`（如已写入 config.json 可省略）|

`$PROJECT_DIR$` 是 IntelliJ 内置变量，每次启动时自动替换为当前工程根目录，**切换工程无需修改配置**。

Click **Apply**.

**Step 3 — Open the panel**

The AI Agent panel appears in the right sidebar. Select **devtool-copilot** from the agent dropdown and start chatting.

**Step 4 — Verify**

Type `/status` in the chat box to confirm the connection and active model.

---

## Publishing to npm

This makes the plugin installable anywhere via `npm install -g devtool-copilot`.

**Step 1 — Prepare `package.json`**

Ensure the following fields are set correctly before publishing:

```json
{
  "name": "devtool-copilot",
  "version": "0.1.0",
  "description": "AI developer assistant powered by DeepAgents, supports Zed and IntelliJ ACP",
  "type": "module",
  "bin": { "devtool-copilot": "./dist/cli.js" },
  "files": ["dist", "config.json", "README.md", "PLUGIN.md"],
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/your-org/devtool-copilot.git"
  }
}
```

Add a `"files"` field to control what gets included in the published package:

```bash
# Edit package.json to add the files field, then verify what will be published
npm pack --dry-run
```

**Step 2 — Log in to npm**

```bash
npm login
# Follow the prompts (email, password, OTP)
```

**Step 3 — Build and publish**

```bash
npm run build
npm publish --access public
```

**Step 4 — Verify**

```bash
npm info devtool-copilot
npm install -g devtool-copilot
devtool-copilot --version
```

**Subsequent releases**

Bump the version in `package.json` and repeat:

```bash
# Patch (0.1.0 → 0.1.1)
npm version patch

# Minor (0.1.0 → 0.2.0)
npm version minor

npm run build && npm publish
```

---

## Publishing to the Zed Extension Marketplace

Zed extensions are distributed via the [`zed-industries/extensions`](https://github.com/zed-industries/extensions) GitHub repository. The process is:

1. Create a standalone Zed extension repository containing `extension.toml`
2. Submit a pull request to `zed-industries/extensions` adding your extension as a Git submodule
3. Once merged, Zed packages and distributes the extension automatically

> **Note:** Zed extensions are primarily used for language support, themes, snippets, and MCP servers. An ACP agent is wired up through `settings.json` rather than through the extension manifest's declared features. However, publishing as a Zed extension provides discoverability in the Extensions panel and allows users to install the plugin with one click.

### 1. Create the Zed Extension Repository

Create a new public GitHub repository, e.g. `your-org/devtool-copilot-zed`.

The repository layout:

```
devtool-copilot-zed/
├── extension.toml      # Required Zed extension manifest
├── LICENSE             # Required (MIT, Apache-2.0, etc.)
├── README.md           # Shown in the Extensions panel
└── install.sh          # Optional helper script
```

> The extension repository is **separate** from the main `devtool-copilot` npm package repository. The Zed extension acts as a thin wrapper that documents how to install and configure the npm binary.

### 2. Write extension.toml

```toml
id = "devtool-copilot"
name = "devtool-copilot"
version = "0.1.0"
schema_version = 1
authors = ["Your Name <you@example.com>"]
description = "AI developer assistant with Agent/Plan/Ask modes. Powered by DeepAgents over ACP."
repository = "https://github.com/your-org/devtool-copilot-zed"
```

**Constraints enforced by Zed:**

| Rule | Detail |
|------|--------|
| `id` | Lowercase, hyphens allowed; must be globally unique; **cannot be changed after publication** |
| `id` / `name` | Must not contain the words `zed`, `Zed`, or `extension` |
| `version` | Must match the Git tag when the PR is submitted |
| LICENSE | Required; must be an OSI-approved license (MIT, Apache-2.0, GPL, BSD variants) |
| No bundled binaries | The extension may not bundle pre-compiled binaries; users install via npm |

### 3. Test Locally with Zed Dev Extension

Before submitting, verify Zed accepts the manifest:

```
Zed → Extensions (Cmd+Shift+X) → Install Dev Extension → select devtool-copilot-zed/
```

Check the Zed logs for errors:

```bash
# macOS
tail -f ~/Library/Logs/Zed/Zed.log

# Linux
tail -f ~/.local/share/zed/logs/Zed.log
```

### 4. Submit a PR to zed-industries/extensions

**Step 1 — Fork the extensions repository**

```bash
git clone https://github.com/YOUR_USERNAME/extensions.git
cd extensions
```

**Step 2 — Add your extension as a Git submodule**

The submodule path must follow the pattern `extensions/{extension-id}`. Use HTTPS (not SSH) for the submodule URL.

```bash
git submodule add https://github.com/your-org/devtool-copilot-zed.git \
    extensions/devtool-copilot
```

**Step 3 — Add an entry to extensions.toml**

Open `extensions.toml` and add:

```toml
[devtool-copilot]
submodule = "extensions/devtool-copilot"
version = "0.1.0"
```

The version must exactly match the `version` field in your `extension.toml`.

**Step 4 — Sort the extension files**

The repository uses `pnpm` to keep `extensions.toml` and `.gitmodules` alphabetically sorted:

```bash
pnpm sort-extensions
```

**Step 5 — Commit and open a PR**

```bash
git add extensions/devtool-copilot extensions.toml .gitmodules
git commit -m "Add devtool-copilot extension"
git push origin main
```

Open a pull request against `zed-industries/extensions:main`. The PR title should follow the convention: `Add devtool-copilot`.

The Zed team reviews PRs manually. Once merged, the extension is automatically packaged and appears in the Extensions panel within a few minutes.

**Updating the extension**

To publish a new version:
1. Tag the new version in your extension repository (`git tag v0.2.0 && git push --tags`)
2. Update the submodule ref and bump the version in `extensions.toml` in your fork of `zed-industries/extensions`
3. Open a new PR with the title: `Update devtool-copilot to 0.2.0`

---

## Distribution Checklist

Use this checklist before any release:

```
Build
  [ ] npm run build succeeds with zero TypeScript errors
  [ ] node dist/cli.js --version prints the correct version
  [ ] node dist/cli.js --help shows all options

Local testing
  [ ] Binary works with ANTHROPIC_API_KEY set
  [ ] Binary works with OPENAI_API_KEY set
  [ ] Custom provider config loads correctly
  [ ] Zed connects and /agent /plan /ask modes respond
  [ ] IntelliJ AI Agent panel connects and responds

npm publish
  [ ] package.json version bumped
  [ ] "files" field includes dist/, config.json, README.md, PLUGIN.md
  [ ] npm pack --dry-run shows no unexpected files
  [ ] npm publish succeeds
  [ ] npm install -g devtool-copilot@<version> installs cleanly

Zed extension
  [ ] extension.toml version matches Git tag
  [ ] extension.toml id/name contain no forbidden words
  [ ] LICENSE file present
  [ ] Zed Dev Extension loads without errors
  [ ] PR to zed-industries/extensions opened and pnpm sort-extensions run
```
