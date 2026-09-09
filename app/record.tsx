import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { DeviceMotion } from 'expo-sensors';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import type { SQLiteDatabase } from 'expo-sqlite';

import {
  ACCELERATION_HORIZONTAL_MIN,
  ACCELERATION_WINDOW_MS,
  evaluateAcceleration,
  evaluateStillness,
  horizontalAccelerationMagnitude,
  upFromGravityAverage,
  type TimedSample,
} from '../src/core/calibration';
import { haversineDistance, type LatLon } from '../src/core/distance';
import {
  buildVehicleFrame,
  GRAVITY_MS2,
  loadFromAcceleration,
  toVehicleAcceleration,
  type Load,
  type VehicleFrame,
} from '../src/core/vehicle-frame';
import type { Vector3 } from '../src/core/vector';
import { getDatabase } from '../src/db/schema';
import { insertAccelerations, insertLocations, type AccelerationSample, type LocationSample } from '../src/db/samples';
import { createSession, endSession } from '../src/db/sessions';
import { formatDistanceM } from '../src/ui/format';
import { LoadArrow } from '../src/ui/LoadArrow';

/** 加速度センサーの更新間隔。50 Hz（`docs/developer/specification.mdx`「サンプリングと書き込み」）。 */
const SENSOR_UPDATE_INTERVAL_MS = 20;
/** 判定窓（直近 2 秒）を常に切り出せるよう、これより長く履歴を保つ。 */
const SAMPLE_HISTORY_MS = 3000;
/** 位置情報の取得間隔。1 Hz（`docs/developer/specification.mdx`「サンプリングと書き込み」）。 */
const LOCATION_UPDATE_INTERVAL_MS = 1000;
/** メモリに積んだ加速度・位置情報をまとめて書き込む間隔。書き込み頻度による負荷を抑えつつ、異常終了時に失われる量を小さく保つ。 */
const FLUSH_INTERVAL_MS = 5000;
/** 経過時間の表示更新間隔。 */
const ELAPSED_DISPLAY_INTERVAL_MS = 1000;
/**
 * センサーの値を画面へ反映する間隔。センサーは 50 Hz で届くが、表示は 10 Hz で足りる。
 * 届いたサンプルごとに描き直すと、車載で長時間動かしたときの発熱と電池の消耗が増える。
 */
const LIVE_DISPLAY_INTERVAL_MS = 100;

const ZERO_LOAD: Load = { front: 0, right: 0 };

/**
 * キャリブレーションは 静止 → 加速 → 確認 の順に自動で進む。
 * 途中で権限が拒否された場合、または「やり直す」が押された場合を除き、ユーザー操作は要らない。
 * 確認の段階で「記録を開始」を押すと記録の段階へ進む。
 */
type Phase =
  | { readonly kind: 'requesting-permission' }
  | { readonly kind: 'permission-denied'; readonly reason: string }
  | { readonly kind: 'stillness' }
  | { readonly kind: 'acceleration'; readonly gravityAverage: Vector3 }
  | { readonly kind: 'confirm'; readonly frame: VehicleFrame }
  | { readonly kind: 'recording'; readonly frame: VehicleFrame }
  | { readonly kind: 'recording-failed'; readonly reason: string };

/** 判定窓に使う直近サンプルだけを残し、段階が長引いても履歴が際限なく増えないようにする。 */
function pruneSamples(samples: readonly TimedSample[]): readonly TimedSample[] {
  if (samples.length === 0) return samples;
  const latestT = samples[samples.length - 1].t;
  return samples.filter((sample) => sample.t >= latestT - SAMPLE_HISTORY_MS);
}

/**
 * 記録 1 回分の状態。加速度・位置情報はコールバックごとに書き込まず、この配列へ積んでから
 * `flushBuffers` で数秒ごとにまとめて書き込む。頻繁に更新されるため React の state ではなく
 * 通常のオブジェクトで保持する。
 */
type RecordingSession = {
  readonly db: SQLiteDatabase;
  readonly sessionId: number;
  readonly startedAt: number;
  accelerationBuffer: AccelerationSample[];
  locationBuffer: LocationSample[];
  lastLocation: LatLon | undefined;
  distanceM: number;
  motionSubscription: { remove: () => void } | undefined;
  locationSubscription: Location.LocationSubscription | undefined;
  flushTimer: ReturnType<typeof setInterval> | undefined;
  elapsedTimer: ReturnType<typeof setInterval> | undefined;
  /** 直近の書き込みの完了を表す。書き込みは必ずこれに数珠つなぎして直列に行う。 */
  flushChain: Promise<void>;
  stopped: boolean;
};

/**
 * バッファに積んだ加速度・位置情報をまとめて 1 回ずつ書き込み、バッファを空にする。
 * 書き込みに失敗した場合、取り出した分をバッファへ戻して次回の書き込みで再送する。
 */
async function flushBuffers(session: RecordingSession): Promise<void> {
  const accelerations = session.accelerationBuffer;
  const locations = session.locationBuffer;
  session.accelerationBuffer = [];
  session.locationBuffer = [];
  try {
    // 同じ接続で 2 つの書き込みトランザクションを同時に走らせると競合するため、順に行う。
    await insertAccelerations(session.db, session.sessionId, accelerations);
    await insertLocations(session.db, session.sessionId, locations);
  } catch (error) {
    session.accelerationBuffer = [...accelerations, ...session.accelerationBuffer];
    session.locationBuffer = [...locations, ...session.locationBuffer];
    throw error;
  }
}

/**
 * 書き込みを `flushChain` に数珠つなぎし、常に前の書き込みの後に始まるようにする。
 * タイマー由来の書き込みと「停止して保存」の最終書き込みが同時に走ることを防ぐ。
 */
function scheduleFlush(session: RecordingSession): Promise<void> {
  const next = session.flushChain.catch(() => undefined).then(() => flushBuffers(session));
  session.flushChain = next;
  return next;
}

/** 経過時間を「MM:SS」(1 時間以上は「HH:MM:SS」)に整形する。 */
function formatElapsedTime(elapsedMs: number): string {
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours > 0 ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

/** 荷重の大きさを G 単位で整形する。 */
function formatLoadMagnitude(load: Load): string {
  const magnitudeG = Math.sqrt(load.front ** 2 + load.right ** 2) / GRAVITY_MS2;
  return `${magnitudeG.toFixed(2)} G`;
}

export default function RecordScreen() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: 'requesting-permission' });
  const [liveLoad, setLiveLoad] = useState<Load>(ZERO_LOAD);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [distanceM, setDistanceM] = useState(0);
  const [stopError, setStopError] = useState<string | undefined>(undefined);
  /** 加速フェーズで表示する、直近 2 秒の水平加速度。まだ 2 秒分そろっていなければ undefined。 */
  const [horizontalMs2, setHorizontalMs2] = useState<number | undefined>(undefined);
  const recordingRef = useRef<RecordingSession | null>(null);
  const displayUpdatedAtRef = useRef(0);

  /** 表示を更新してよい頃合いなら true を返す。センサーのコールバックからはこれで間引く。 */
  const shouldUpdateDisplay = useCallback(() => {
    const now = Date.now();
    if (now - displayUpdatedAtRef.current < LIVE_DISPLAY_INTERVAL_MS) return false;
    displayUpdatedAtRef.current = now;
    return true;
  }, []);

  // 画面に入った時点で位置情報と DeviceMotion の権限をまとめて要求する。
  // キャリブレーションの途中で権限ダイアログを出すと、運転中に操作を求めることになるため。
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [locationPermission, motionPermission] = await Promise.all([
        Location.requestForegroundPermissionsAsync(),
        DeviceMotion.requestPermissionsAsync(),
      ]);
      if (cancelled) return;

      if (locationPermission.status !== 'granted') {
        setPhase({
          kind: 'permission-denied',
          reason:
            '位置情報の利用が許可されていないため、記録を始められません。設定アプリで位置情報の利用を許可してください。',
        });
        return;
      }
      if (motionPermission.status !== 'granted') {
        setPhase({
          kind: 'permission-denied',
          reason:
            'モーションセンサーの利用が許可されていないため、記録を始められません。設定アプリでモーションとフィットネスの利用を許可してください。',
        });
        return;
      }

      DeviceMotion.setUpdateInterval(SENSOR_UPDATE_INTERVAL_MS);
      setPhase({ kind: 'stillness' });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 静止・加速・確認の各段階で DeviceMotion を購読する。段階が変わるたびに購読を張り直し、
  // 判定用の履歴も段階の開始からゼロで積み直す。
  useEffect(() => {
    if (phase.kind !== 'stillness' && phase.kind !== 'acceleration' && phase.kind !== 'confirm') {
      return;
    }

    let samples: readonly TimedSample[] = [];
    let transitioned = false;
    const phaseStartedAt = Date.now();

    const subscription = DeviceMotion.addListener((measurement) => {
      // 段階を切り替えた直後、購読が張り替わるまでの数ティックを二重に処理しないようにする。
      if (transitioned) return;
      const t = Date.now() - phaseStartedAt;

      if (phase.kind === 'stillness') {
        samples = pruneSamples([...samples, { t, acceleration: measurement.accelerationIncludingGravity }]);
        const gravityAverage = evaluateStillness(samples);
        if (gravityAverage) {
          transitioned = true;
          setPhase({ kind: 'acceleration', gravityAverage });
        }
        return;
      }

      // 加速・確認の判定と表示にはユーザー加速度（重力を除いた値）を使う。
      if (!measurement.acceleration) return;

      if (phase.kind === 'acceleration') {
        samples = pruneSamples([...samples, { t, acceleration: measurement.acceleration }]);
        const up = upFromGravityAverage(phase.gravityAverage);
        const accelerationAverage = evaluateAcceleration(samples, up);
        if (accelerationAverage) {
          transitioned = true;
          setPhase({ kind: 'confirm', frame: buildVehicleFrame(phase.gravityAverage, accelerationAverage) });
          return;
        }
        if (shouldUpdateDisplay()) setHorizontalMs2(horizontalAccelerationMagnitude(samples, up));
        return;
      }

      if (shouldUpdateDisplay()) {
        setLiveLoad(loadFromAcceleration(toVehicleAcceleration(phase.frame, measurement.acceleration)));
      }
    });

    return () => subscription.remove();
  }, [phase, shouldUpdateDisplay]);

  // 記録の段階では、車両座標系へ変換した加速度と位置情報をバッファへ積み、
  // 5 秒ごとにまとめて書き込む。コールバックごとの書き込みはしない。
  useEffect(() => {
    if (phase.kind !== 'recording') return;

    let cancelled = false;

    (async () => {
      try {
        const startedAt = Date.now();
        const db = await getDatabase();
        const sessionId = await createSession(db, startedAt);
        if (cancelled) return;

        await activateKeepAwakeAsync();
        if (cancelled) {
          await deactivateKeepAwake();
          return;
        }

        const session: RecordingSession = {
          db,
          sessionId,
          startedAt,
          accelerationBuffer: [],
          locationBuffer: [],
          lastLocation: undefined,
          distanceM: 0,
          motionSubscription: undefined,
          locationSubscription: undefined,
          flushTimer: undefined,
          elapsedTimer: undefined,
          flushChain: Promise.resolve(),
          stopped: false,
        };
        recordingRef.current = session;

        session.motionSubscription = DeviceMotion.addListener((measurement) => {
          if (!measurement.acceleration) return;
          const vehicleAcceleration = toVehicleAcceleration(phase.frame, measurement.acceleration);
          session.accelerationBuffer.push({ t: Date.now(), ax: vehicleAcceleration.ax, ay: vehicleAcceleration.ay });
          if (shouldUpdateDisplay()) setLiveLoad(loadFromAcceleration(vehicleAcceleration));
        });

        // 位置情報は 1 Hz で取得する。ネイティブ側の通知がこれより頻繁でも、
        // 直前のサンプルからの経過時間で間引いて 1 Hz に揃える。
        let lastLocationAt: number | undefined;
        session.locationSubscription = await Location.watchPositionAsync(
          { timeInterval: LOCATION_UPDATE_INTERVAL_MS, distanceInterval: 0 },
          (location) => {
            if (lastLocationAt !== undefined && location.timestamp - lastLocationAt < LOCATION_UPDATE_INTERVAL_MS) {
              return;
            }
            lastLocationAt = location.timestamp;

            const point: LatLon = { lat: location.coords.latitude, lon: location.coords.longitude };
            if (session.lastLocation) {
              session.distanceM += haversineDistance(session.lastLocation, point);
              setDistanceM(session.distanceM);
            }
            session.lastLocation = point;
            session.locationBuffer.push({ t: location.timestamp, lat: point.lat, lon: point.lon });
          },
        );
        if (cancelled) {
          session.locationSubscription.remove();
          return;
        }

        session.flushTimer = setInterval(() => {
          scheduleFlush(session).catch((error) => {
            console.error('走行データの書き込みに失敗しました', error);
          });
        }, FLUSH_INTERVAL_MS);

        session.elapsedTimer = setInterval(() => {
          setElapsedMs(Date.now() - session.startedAt);
        }, ELAPSED_DISPLAY_INTERVAL_MS);
      } catch (error) {
        if (!cancelled) {
          console.error('記録の開始に失敗しました', error);
          setPhase({
            kind: 'recording-failed',
            reason: '記録を開始できませんでした。電波状況の良い場所でもう一度お試しください。',
          });
        }
      }
    })();

    return () => {
      cancelled = true;
      const session = recordingRef.current;
      session?.motionSubscription?.remove();
      session?.locationSubscription?.remove();
      if (session?.flushTimer) clearInterval(session.flushTimer);
      if (session?.elapsedTimer) clearInterval(session.elapsedTimer);
      // 「停止して保存」を経ずに画面を離れた場合(戻る操作など)でも、画面の消灯抑止を必ず解除する。
      // すでに handleStop で解除済みのときは無害な二重呼び出しになる。
      deactivateKeepAwake();
    };
  }, [phase, shouldUpdateDisplay]);

  const handleRestart = useCallback(() => {
    displayUpdatedAtRef.current = 0;
    setLiveLoad(ZERO_LOAD);
    setHorizontalMs2(undefined);
    setPhase({ kind: 'stillness' });
  }, []);

  const handleStartRecording = useCallback(() => {
    setPhase((current) => (current.kind === 'confirm' ? { kind: 'recording', frame: current.frame } : current));
  }, []);

  const handleBackToList = useCallback(() => {
    router.replace('/');
  }, [router]);

  // 停止と保存。バッファに残ったサンプルも書き込んでからセッションを確定し、一覧へ戻る。
  // 書き込みに失敗した場合は完了状態にせず、再度「停止して保存」を押せばやり直せるようにする。
  const handleStop = useCallback(async () => {
    const session = recordingRef.current;
    if (!session || session.stopped) return;
    setStopError(undefined);

    if (session.flushTimer) clearInterval(session.flushTimer);
    if (session.elapsedTimer) clearInterval(session.elapsedTimer);
    session.motionSubscription?.remove();
    session.locationSubscription?.remove();

    const endedAt = Date.now();
    const durationMs = endedAt - session.startedAt;
    try {
      await scheduleFlush(session);
      await endSession(session.db, session.sessionId, endedAt, durationMs, session.distanceM);
    } catch (error) {
      console.error('記録の保存に失敗しました', error);
      setStopError('保存に失敗しました。もう一度「停止して保存」を押してください。');
      return;
    }
    session.stopped = true;
    await deactivateKeepAwake();

    router.replace('/');
  }, [router]);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: '記録の準備' }} />

      {phase.kind === 'requesting-permission' && (
        <View style={styles.center}>
          <Text style={styles.message}>権限を確認しています…</Text>
        </View>
      )}

      {phase.kind === 'permission-denied' && (
        <View style={styles.center}>
          <Text style={styles.message}>{phase.reason}</Text>
          <Pressable style={styles.primaryButton} onPress={handleBackToList}>
            <Text style={styles.primaryButtonLabel}>一覧へ戻る</Text>
          </Pressable>
        </View>
      )}

      {phase.kind === 'recording-failed' && (
        <View style={styles.center}>
          <Text style={styles.message}>{phase.reason}</Text>
          <Pressable style={styles.primaryButton} onPress={handleBackToList}>
            <Text style={styles.primaryButtonLabel}>一覧へ戻る</Text>
          </Pressable>
        </View>
      )}

      {phase.kind === 'stillness' && (
        <View style={styles.center}>
          <Text style={styles.message}>停車したままお待ちください</Text>
        </View>
      )}

      {phase.kind === 'acceleration' && (
        <View style={styles.center}>
          <Text style={styles.message}>まっすぐ加速してください</Text>
          <Text style={styles.loadMagnitude}>
            {horizontalMs2 === undefined ? '—' : `${horizontalMs2.toFixed(1)} m/s²`}
          </Text>
          <Text style={styles.hint}>
            {ACCELERATION_HORIZONTAL_MIN.toFixed(1)} m/s² 以上をまっすぐ {ACCELERATION_WINDOW_MS / 1000} 秒続けると、
            次へ進みます
          </Text>
          <Text style={styles.hint}>時速 10 km まで 10 m ほど、ゆっくり進むだけで足ります</Text>
        </View>
      )}

      {phase.kind === 'confirm' && (
        <View style={styles.center}>
          <LoadArrow load={liveLoad} />
          <Text style={styles.hint}>軽くブレーキを踏むと、矢印が前を向きます</Text>
          <Text style={styles.hint}>右へ曲がると、矢印が左を向きます</Text>
          <Pressable style={styles.primaryButton} onPress={handleStartRecording}>
            <Text style={styles.primaryButtonLabel}>記録を開始</Text>
          </Pressable>
          <Pressable style={styles.retryButton} onPress={handleRestart}>
            <Text style={styles.retryButtonLabel}>やり直す</Text>
          </Pressable>
        </View>
      )}

      {phase.kind === 'recording' && (
        <View style={styles.center}>
          <LoadArrow load={liveLoad} />
          <Text style={styles.loadMagnitude}>{formatLoadMagnitude(liveLoad)}</Text>
          <View style={styles.recordingStats}>
            <View style={styles.recordingStatItem}>
              <Text style={styles.recordingStatLabel}>経過時間</Text>
              <Text style={styles.recordingStatValue}>{formatElapsedTime(elapsedMs)}</Text>
            </View>
            <View style={styles.recordingStatItem}>
              <Text style={styles.recordingStatLabel}>走行距離</Text>
              <Text style={styles.recordingStatValue}>{formatDistanceM(distanceM)}</Text>
            </View>
          </View>
          <Pressable style={styles.stopButton} onPress={handleStop}>
            <Text style={styles.stopButtonLabel}>停止して保存</Text>
          </Pressable>
          {stopError && <Text style={styles.hint}>{stopError}</Text>}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  message: {
    fontSize: 18,
    textAlign: 'center',
  },
  hint: {
    fontSize: 15,
    color: '#666666',
    textAlign: 'center',
    marginTop: 12,
  },
  primaryButton: {
    backgroundColor: '#1a73e8',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 32,
    marginTop: 24,
  },
  primaryButtonLabel: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '700',
  },
  retryButton: {
    marginTop: 16,
    paddingVertical: 8,
  },
  retryButtonLabel: {
    color: '#666666',
    fontSize: 15,
  },
  loadMagnitude: {
    fontSize: 28,
    fontWeight: '700',
    marginTop: 8,
  },
  recordingStats: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
    marginTop: 32,
  },
  recordingStatItem: {
    alignItems: 'center',
  },
  recordingStatLabel: {
    fontSize: 14,
    color: '#666666',
  },
  recordingStatValue: {
    fontSize: 32,
    fontWeight: '700',
    marginTop: 4,
  },
  stopButton: {
    backgroundColor: '#cc3333',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 32,
    marginTop: 40,
  },
  stopButtonLabel: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '700',
  },
});
