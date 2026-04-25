# Contributing to llmrix-devtool

Thank you for your interest in contributing to **llmrix-devtool**! We welcome contributions of all kinds, from bug reports and documentation improvements to new features and security fixes.

## Development Setup

### Prerequisites

- **Node.js**: v18.x or later
- **npm**: v10.x or later

### Getting Started

1. **Clone the repository**:
   ```bash
   git clone https://github.com/anearly/llmrix-devtool.git
   cd llmrix-devtool
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Run in development mode**:
   Use `tsx` to run the source code directly without compiling:
   ```bash
   npm run dev -- --workspace /path/to/test-project --debug
   ```

4. **Build the project**:
   ```bash
   npm run build
   ```

## Project Structure

- `src/cli.ts`: Entry point for the Command Line Interface.
- `src/server.ts`: The ACP (Agent Client Protocol) server implementation.
- `src/agent/`: Core logic for agent behaviors and task execution.
- `src/providers/`: LLM provider integrations (Anthropic, OpenAI, etc.).
- `src/config/`: Configuration management logic.
- `src/templates/`: Default prompt and instruction templates.
- `scripts/`: Build and development utility scripts.

## Coding Guidelines

- **TypeScript**: We use TypeScript for all logic. Ensure your code passes type checking (`npm run build` runs `tsc`).
- **Async/Await**: Prefer `async/await` over raw Promises or callbacks.
- **Error Handling**: Use descriptive error messages and handle edge cases (e.g., missing API keys, network failures).
- **ES Modules**: This project uses `"type": "module"`.

## Pull Request Process

1. **Create a branch**: Use a descriptive name like `fix/auth-leak` or `feat/deepseek-provider`.
2. **Commit changes**: Write clear, concise commit messages.
3. **Verify build**: Ensure `npm run build` completes successfully before submitting.
4. **Submit PR**: Provide a clear description of what changed and why.

## Reporting Issues

If you find a bug or have a feature request, please open an issue with:
- A clear title and description.
- Steps to reproduce (for bugs).
- Expected vs. actual behavior.

## License

By contributing to this project, you agree that your contributions will be licensed under the [MIT License](LICENSE).
