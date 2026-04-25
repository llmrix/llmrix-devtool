/**
 * Recursively resolve environment variable placeholders `${VAR}` in a config
 * object or array.
 */
export function resolveEnvVars<T>(obj: T): T {
  if (typeof obj === "string") {
    return obj.replace(/\${([^}]+)}/g, (_, name) => process.env[name] || "") as unknown as T;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => resolveEnvVars(item)) as unknown as T;
  }

  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = resolveEnvVars(value);
    }
    return result as unknown as T;
  }

  return obj;
}
