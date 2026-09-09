/**
 * 位置情報・加速度の読み書き（`docs/developer/specification.mdx`「データ構造」）。
 *
 * どちらもセンサーのコールバックごとに書き込まず、呼び出し側がメモリ上にまとめた配列を
 * 1 トランザクションで書き込む。加速度は 50 Hz で量が多いため、時刻範囲を指定して
 * 取り出す関数だけを提供し、セッション全件を読み込む関数は持たない。
 */

import type { SQLiteDatabase } from 'expo-sqlite';

export type LocationSample = {
  readonly t: number;
  readonly lat: number;
  readonly lon: number;
};

export type AccelerationSample = {
  readonly t: number;
  readonly ax: number;
  readonly ay: number;
};

/** 位置情報をまとめて 1 トランザクションで書き込む。 */
export async function insertLocations(
  db: SQLiteDatabase,
  sessionId: number,
  samples: readonly LocationSample[],
): Promise<void> {
  if (samples.length === 0) return;
  await db.withExclusiveTransactionAsync(async (txn) => {
    for (const sample of samples) {
      await txn.runAsync('INSERT INTO locations (session_id, t, lat, lon) VALUES (?, ?, ?, ?)', [
        sessionId,
        sample.t,
        sample.lat,
        sample.lon,
      ]);
    }
  });
}

/** 加速度をまとめて 1 トランザクションで書き込む。 */
export async function insertAccelerations(
  db: SQLiteDatabase,
  sessionId: number,
  samples: readonly AccelerationSample[],
): Promise<void> {
  if (samples.length === 0) return;
  await db.withExclusiveTransactionAsync(async (txn) => {
    for (const sample of samples) {
      await txn.runAsync('INSERT INTO accelerations (session_id, t, ax, ay) VALUES (?, ?, ?, ?)', [
        sessionId,
        sample.t,
        sample.ax,
        sample.ay,
      ]);
    }
  });
}

/** セッションの位置情報を時刻昇順で全件返す。ルート描画に使う（1 Hz なので全件でも軽い）。 */
export async function getLocations(db: SQLiteDatabase, sessionId: number): Promise<readonly LocationSample[]> {
  return db.getAllAsync<LocationSample>('SELECT t, lat, lon FROM locations WHERE session_id = ? ORDER BY t ASC', [
    sessionId,
  ]);
}

/**
 * 指定した時刻範囲の加速度を時刻昇順で返す。範囲外は読まない。
 * G-G ダイアグラムの表示や、ルートの区間ごとの色分けに使う。
 */
export async function getAccelerations(
  db: SQLiteDatabase,
  sessionId: number,
  startT: number,
  endT: number,
): Promise<readonly AccelerationSample[]> {
  return db.getAllAsync<AccelerationSample>(
    'SELECT t, ax, ay FROM accelerations WHERE session_id = ? AND t >= ? AND t <= ? ORDER BY t ASC',
    [sessionId, startT, endT],
  );
}
