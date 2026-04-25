/**
 * SQLite-backed LangGraph checkpoint saver.
 *
 * Persists conversation state to:
 *   ~/.codai/sessions/sessions.db
 *
 * The directory is created automatically on first use.
 */

import fs from "node:fs";
import path from "node:path";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { SESSIONS_DB_PATH } from "../constants.js";

/**
 * Create and return a `SqliteSaver` backed by the given database file.
 * The parent directory is created recursively if it does not exist.
 *
 * @param dbPath - Absolute path to the SQLite database file.
 *                 Defaults to `~/.codai/sessions/sessions.db`.
 */
export function createCheckpointer(dbPath: string = SESSIONS_DB_PATH): SqliteSaver {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  return SqliteSaver.fromConnString(dbPath);
}
