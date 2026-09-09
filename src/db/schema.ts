/**
 * SQLite データベースの初期化（`docs/developer/specification.mdx`「データ構造」）。
 *
 * `sessions` ・ `locations` ・ `accelerations` の 3 表と `(session_id, t)` の索引を作り、
 * 外部キーの連鎖削除を有効にする。アプリ全体で 1 つの接続を共有する。
 */

import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';

const DATABASE_NAME = 'driving-load.db';

const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sessions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at   INTEGER NOT NULL,
  ended_at     INTEGER,
  duration_ms  INTEGER NOT NULL DEFAULT 0,
  distance_m   REAL    NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS locations (
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  t          INTEGER NOT NULL,
  lat        REAL    NOT NULL,
  lon        REAL    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_locations_session_t ON locations (session_id, t);

CREATE TABLE IF NOT EXISTS accelerations (
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  t          INTEGER NOT NULL,
  ax         REAL    NOT NULL,
  ay         REAL    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_accelerations_session_t ON accelerations (session_id, t);
`;

let database: Promise<SQLiteDatabase> | undefined;

async function openDatabase(): Promise<SQLiteDatabase> {
  const db = await openDatabaseAsync(DATABASE_NAME);
  await db.execAsync(SCHEMA);
  return db;
}

/**
 * アプリ全体で共有する接続を返す。初回呼び出しでだけ開いて表と索引を用意する。
 * 初回の接続に失敗した場合は結果をキャッシュせず、次回の呼び出しで開き直す。
 */
export function getDatabase(): Promise<SQLiteDatabase> {
  if (!database) {
    database = openDatabase().catch((error) => {
      database = undefined;
      throw error;
    });
  }
  return database;
}
