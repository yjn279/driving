/**
 * セッション詳細画面。地図上に合計 G で色分けしたルートを描き、
 * タップした地点の前後 3 秒の荷重の軌跡を G-G ダイアグラムに表示する。
 */

import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import MapView, { Marker, Polyline, type MapPressEvent, type Region } from 'react-native-maps';

import { haversineDistance, type LatLon } from '../../src/core/distance';
import { loadFromAcceleration } from '../../src/core/vehicle-frame';
import { getDatabase } from '../../src/db/schema';
import { getAccelerations, getLocations, type AccelerationSample, type LocationSample } from '../../src/db/samples';
import { GGDiagram, type GGDiagramPoint } from '../../src/ui/GGDiagram';
import { colorForLoadG, loadColorLegend } from '../../src/ui/g-color';

/** G-G ダイアグラムに描く軌跡の時間窓。選択時刻の前後 3 秒（計画「G-G ダイアグラムの時間窓」）。 */
const GG_WINDOW_MS = 3000;
/** タップ地点がルートからこれより離れていたら選択しない。 */
const NEAREST_POINT_MAX_DISTANCE_M = 100;
const MIN_REGION_DELTA = 0.005;
const GRAVITY_MS2 = 9.81;

type RouteSegment = {
  readonly from: LocationSample;
  readonly to: LocationSample;
  readonly color: string;
};

/** ルート全体を囲む範囲を求める。地図の初期表示に使う。 */
function regionForLocations(locations: readonly LocationSample[]): Region | undefined {
  if (locations.length === 0) return undefined;
  const lats = locations.map((location) => location.lat);
  const lons = locations.map((location) => location.lon);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLon + maxLon) / 2,
    latitudeDelta: Math.max((maxLat - minLat) * 1.4, MIN_REGION_DELTA),
    longitudeDelta: Math.max((maxLon - minLon) * 1.4, MIN_REGION_DELTA),
  };
}

/** 区間内の加速度から、合計 G（g 単位）の代表的な大きさを RMS で求める。 */
function averageLoadG(samples: readonly AccelerationSample[]): number {
  if (samples.length === 0) return 0;
  const meanSquare = samples.reduce((sum, s) => sum + s.ax * s.ax + s.ay * s.ay, 0) / samples.length;
  return Math.sqrt(meanSquare) / GRAVITY_MS2;
}

/**
 * 位置情報の隣り合う 2 点ごとに区間を作り、その時間範囲の加速度から色を決める。
 * 区間ごとに時刻範囲を指定して取り出し、使い終えたら次の区間へ進むため、
 * セッション全件の加速度が同時にメモリへ載ることはない。
 */
async function buildRouteSegments(
  sessionId: number,
  locations: readonly LocationSample[],
): Promise<readonly RouteSegment[]> {
  const db = await getDatabase();
  const segments: RouteSegment[] = [];
  for (let i = 0; i < locations.length - 1; i += 1) {
    const from = locations[i];
    const to = locations[i + 1];
    const samples = await getAccelerations(db, sessionId, from.t, to.t);
    segments.push({ from, to, color: colorForLoadG(averageLoadG(samples)) });
  }
  return segments;
}

/** タップ地点に最も近い記録位置と、そこまでの距離を返す。 */
function findNearestLocation(
  locations: readonly LocationSample[],
  point: LatLon,
): { readonly location: LocationSample; readonly distanceM: number } | undefined {
  return locations.reduce<{ location: LocationSample; distanceM: number } | undefined>((nearest, location) => {
    const distanceM = haversineDistance(point, { lat: location.lat, lon: location.lon });
    return !nearest || distanceM < nearest.distanceM ? { location, distanceM } : nearest;
  }, undefined);
}

export default function SessionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const sessionId = Number(id);

  const [locations, setLocations] = useState<readonly LocationSample[]>([]);
  const [segments, setSegments] = useState<readonly RouteSegment[]>([]);
  const [loadingRoute, setLoadingRoute] = useState(true);
  const [selected, setSelected] = useState<LocationSample | undefined>(undefined);
  const [ggPoints, setGgPoints] = useState<readonly GGDiagramPoint[]>([]);

  // ルートと区間ごとの色は、画面を開いたときに一度だけ組み立てる。
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const db = await getDatabase();
      const locs = await getLocations(db, sessionId);
      if (cancelled) return;
      setLocations(locs);
      const built = await buildRouteSegments(sessionId, locs);
      if (cancelled) return;
      setSegments(built);
      setLoadingRoute(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  // 選択地点が変わるたびに、その前後 3 秒だけを時刻範囲で取り出す。
  useEffect(() => {
    if (!selected) {
      setGgPoints([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const db = await getDatabase();
      const samples = await getAccelerations(db, sessionId, selected.t - GG_WINDOW_MS, selected.t + GG_WINDOW_MS);
      if (cancelled) return;
      setGgPoints(samples.map((sample) => ({ t: sample.t, load: loadFromAcceleration(sample) })));
    })();
    return () => {
      cancelled = true;
    };
  }, [selected, sessionId]);

  const handleMapPress = useCallback(
    (event: MapPressEvent) => {
      const { latitude, longitude } = event.nativeEvent.coordinate;
      const nearest = findNearestLocation(locations, { lat: latitude, lon: longitude });
      setSelected(nearest && nearest.distanceM <= NEAREST_POINT_MAX_DISTANCE_M ? nearest.location : undefined);
    },
    [locations],
  );

  const region = regionForLocations(locations);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: '走行の詳細' }} />

      {loadingRoute && (
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      )}

      {!loadingRoute && !region && (
        <View style={styles.center}>
          <Text style={styles.message}>位置情報が記録されていません</Text>
        </View>
      )}

      {!loadingRoute && region && (
        <>
          <MapView style={styles.map} initialRegion={region} onPress={handleMapPress}>
            {segments.map((segment, index) => (
              <Polyline
                key={index}
                coordinates={[
                  { latitude: segment.from.lat, longitude: segment.from.lon },
                  { latitude: segment.to.lat, longitude: segment.to.lon },
                ]}
                strokeColor={segment.color}
                strokeWidth={4}
              />
            ))}
            {selected && (
              <Marker coordinate={{ latitude: selected.lat, longitude: selected.lon }} anchor={{ x: 0.5, y: 0.5 }}>
                <View style={styles.selectedMarker} />
              </Marker>
            )}
          </MapView>

          <View style={styles.legend}>
            {loadColorLegend().map((item) => (
              <View key={item.label} style={styles.legendItem}>
                <View style={[styles.legendSwatch, { backgroundColor: item.color }]} />
                <Text style={styles.legendLabel}>{item.label}</Text>
              </View>
            ))}
          </View>

          <View style={styles.detail}>
            {selected ? (
              <GGDiagram points={ggPoints} currentT={selected.t} />
            ) : (
              <Text style={styles.message}>地図をタップすると、その地点の荷重の軌跡が見られます</Text>
            )}
          </View>
        </>
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
  },
  message: {
    fontSize: 15,
    color: '#666666',
    textAlign: 'center',
    paddingHorizontal: 24,
  },
  map: {
    flex: 3,
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e0e0e0',
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  legendSwatch: {
    width: 12,
    height: 12,
    borderRadius: 3,
    marginRight: 4,
  },
  legendLabel: {
    fontSize: 12,
    color: '#666666',
  },
  selectedMarker: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#0b0b0b',
    borderWidth: 2,
    borderColor: '#ffffff',
  },
  detail: {
    flex: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
