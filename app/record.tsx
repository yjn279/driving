import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { DeviceMotion } from 'expo-sensors';

import { evaluateAcceleration, evaluateStillness, upFromGravityAverage, type TimedSample } from '../src/core/calibration';
import {
  buildVehicleFrame,
  loadFromAcceleration,
  toVehicleAcceleration,
  type Load,
  type VehicleFrame,
} from '../src/core/vehicle-frame';
import type { Vector3 } from '../src/core/vector';
import { LoadArrow } from '../src/ui/LoadArrow';

/** 加速度センサーの更新間隔。50 Hz（`docs/design.md`「データ量とサンプリング」）。 */
const SENSOR_UPDATE_INTERVAL_MS = 20;
/** 判定窓（直近 2 秒）を常に切り出せるよう、これより長く履歴を保つ。 */
const SAMPLE_HISTORY_MS = 3000;

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
  | { readonly kind: 'recording'; readonly frame: VehicleFrame };

/** 判定窓に使う直近サンプルだけを残し、段階が長引いても履歴が際限なく増えないようにする。 */
function pruneSamples(samples: readonly TimedSample[]): readonly TimedSample[] {
  if (samples.length === 0) return samples;
  const latestT = samples[samples.length - 1].t;
  return samples.filter((sample) => sample.t >= latestT - SAMPLE_HISTORY_MS);
}

export default function RecordScreen() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: 'requesting-permission' });
  const [liveLoad, setLiveLoad] = useState<Load>(ZERO_LOAD);

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
        }
        return;
      }

      setLiveLoad(loadFromAcceleration(toVehicleAcceleration(phase.frame, measurement.acceleration)));
    });

    return () => subscription.remove();
  }, [phase]);

  const handleRestart = useCallback(() => {
    setLiveLoad(ZERO_LOAD);
    setPhase({ kind: 'stillness' });
  }, []);

  const handleStartRecording = useCallback(() => {
    setPhase((current) => (current.kind === 'confirm' ? { kind: 'recording', frame: current.frame } : current));
  }, []);

  const handleBackToList = useCallback(() => {
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

      {phase.kind === 'stillness' && (
        <View style={styles.center}>
          <Text style={styles.message}>停車したままお待ちください</Text>
        </View>
      )}

      {phase.kind === 'acceleration' && (
        <View style={styles.center}>
          <Text style={styles.message}>まっすぐ加速してください</Text>
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

      {phase.kind === 'recording' && <View style={styles.container} />}
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
});
