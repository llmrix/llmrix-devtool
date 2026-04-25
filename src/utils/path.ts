import path from "node:path";
import os from "node:os";

/**
 * Normalizes a path and expands the home directory (~) if present.
 *
 * This is necessary because Node's `path.resolve` and `path.join` do not
 * handle the tilde character on any platform, and many IDEs do not expand it
 * before passing paths via environment variables or CLI flags.
 */
export function expandHome(filePath: string): string {
  if (!filePath) return filePath;

  // Handles:
  // ~
  // ~/path
  // ~\path (Windows)
  if (filePath === "~" || filePath.startsWith("~" + path.sep) || filePath.startsWith("~/") || filePath.startsWith("~\\")) {
    return path.join(os.homedir(), filePath.slice(2));
  }

  // Handle exactly "~" (though path.join covers it, slice(2) would fail correctly)
  if (filePath === "~") {
    return os.homedir();
  }

  return filePath;
}

/**
 * Expands home and resolves to an absolute path.
 */
export function resolvePath(filePath: string): string {
  return path.resolve(expandHome(filePath));
}
