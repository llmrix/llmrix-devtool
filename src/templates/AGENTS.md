# LLMrix Devtool Memory & Rules

This file is persistent memory for your AI assistant. The AI will read this file before taking any action in this workspace.

## 🛠️ Technology Stack
<!-- Define your stack to prevent the AI from guessing -->
- Language: [e.g., TypeScript, Python 3.11]
- Framework: [e.g., Next.js 14 (App Router), FastAPI]
- UI/Styling: [e.g., TailwindCSS, Vanilla CSS]

## ✍️ Coding Standards
- **General**: Write highly readable, modular code.
- **Naming**: Use camelCase for variables, PascalCase for classes/components.
- **Error Handling**: Fail fast. Catch specific exceptions, avoid generic try/catch blocks.
- **Formatting**: [e.g., Use Prettier with 2 spaces. Never use tabs.]

## 🏗️ Architecture & Paths
- Core logic lives in `src/core/`
- All tests must be placed in `__tests__/` alongside the original file.
- DO NOT modify files in `dist/` or `build/`.

## 🔒 Security & Git
- Never hardcode API keys or secrets; use environment variables.
- Git commit messages must follow Conventional Commits (feat:, fix:, chore:).
