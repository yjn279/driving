/**
 * セッション（走行 1 回分）の読み書き（`requirement.md`「データ構造」）。
 *
 * 記録開始時に `started_at` だけを持つ行を作り、停止時に `ended_at` ・ `duration_ms` ・
 * `distance_m` を確定する。停止処理が走らずに `ended_at` が NULL のまま残った行は、
 * 走行時間も距離も 0 のまま累計を歪めるため、一覧を開くたびに削除する。
 */

import type { SQLiteDatabase } from 'expo-sqlite';

export type Session = {
  readonly id: number;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly durationMs: number;
  readonly distanceM: number;
};

type SessionRow = {
  id: number;
  started_at: number;
  ended_at: number;
  duration_ms: number;
  distance_m: number;
};

function toSession(row: SessionRow): Session {
  return {
    id: row.id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    durationMs: row.duration_ms,
    distanceM: row.distance_m,
  };
}

/** 記録の開始を記録し、セッション ID を返す。 */
export async function createSession(db: SQLiteDatabase, startedAt: number): Promise<number> {
  const result = await db.runAsync('INSERT INTO sessions (started_at) VALUES (?)', [startedAt]);
  return result.lastInsertRowId;
}

/** 記録の停止を反映する。走行時間・走行距離はここで確定する。 */
export async function endSession(
  db: SQLiteDatabase,
  sessionId: number,
  endedAt: number,
  durationMs: number,
  distanceM: number,
): Promise<void> {
  await db.runAsync('UPDATE sessions SET ended_at = ?, duration_ms = ?, distance_m = ? WHERE id = ?', [
    endedAt,
    durationMs,
    distanceM,
    sessionId,
  ]);
}

/** セッションを削除する。紐づく位置情報・加速度も連鎖削除される。 */
export async function deleteSession(db: SQLiteDatabase, sessionId: number): Promise<void> {
  await db.runAsync('DELETE FROM sessions WHERE id = ?', [sessionId]);
}

/** `ended_at` が NULL のまま残ったセッションを削除する。紐づく位置情報・加速度も連鎖削除される。 */
export async function deleteUnfinishedSessions(db: SQLiteDatabase): Promise<void> {
  await db.runAsync('DELETE FROM sessions WHERE ended_at IS NULL');
}

export type SessionSummary = {
  readonly sessions: readonly Session[];
  readonly totalDurationMs: number;
  readonly totalDistanceM: number;
};

/** 完了済みセッションを日時の新しい順に並べ、走行時間・走行距離の累計とともに返す。 */
export async function listSessions(db: SQLiteDatabase): Promise<SessionSummary> {
  const rows = await db.getAllAsync<SessionRow>(
    'SELECT id, started_at, ended_at, duration_ms, distance_m FROM sessions WHERE ended_at IS NOT NULL ORDER BY started_at DESC',
  );
  const sessions = rows.map(toSession);
  const totalDurationMs = sessions.reduce((sum, session) => sum + session.durationMs, 0);
  const totalDistanceM = sessions.reduce((sum, session) => sum + session.distanceM, 0);
  return { sessions, totalDurationMs, totalDistanceM };
}
