import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Link, Stack, useFocusEffect } from 'expo-router';

import { getDatabase } from '../src/db/schema';
import { deleteSession, deleteUnfinishedSessions, listSessions, type SessionSummary } from '../src/db/sessions';

/** ミリ秒を「◯時間◯分」のような表示へ整形する。 */
function formatDuration(durationMs: number): string {
  const totalSeconds = Math.floor(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}時間${minutes}分`;
  if (minutes > 0) return `${minutes}分${seconds}秒`;
  return `${seconds}秒`;
}

/** メートルを「◯ m」または「◯.◯ km」に整形する。 */
function formatDistance(distanceM: number): string {
  if (distanceM >= 1000) return `${(distanceM / 1000).toFixed(1)} km`;
  return `${Math.round(distanceM)} m`;
}

/** epoch ミリ秒を「YYYY/MM/DD HH:mm」に整形する。 */
function formatDateTime(epochMs: number): string {
  const date = new Date(epochMs);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default function IndexScreen() {
  const [summary, setSummary] = useState<SessionSummary | null>(null);

  const reload = useCallback(async () => {
    const db = await getDatabase();
    // アプリが落ちるなどして停止処理が走らなかったセッションは、走行時間・距離が 0 のまま
    // 累計を歪めるため、一覧を開くたびに削除する。
    await deleteUnfinishedSessions(db);
    setSummary(await listSessions(db));
  }, []);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  const handleDelete = useCallback(
    async (sessionId: number) => {
      const db = await getDatabase();
      await deleteSession(db, sessionId);
      setSummary(await listSessions(db));
    },
    [],
  );

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: '走行記録' }} />
      <View style={styles.summary}>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryLabel}>累計走行時間</Text>
          <Text style={styles.summaryValue}>{formatDuration(summary?.totalDurationMs ?? 0)}</Text>
        </View>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryLabel}>累計走行距離</Text>
          <Text style={styles.summaryValue}>{formatDistance(summary?.totalDistanceM ?? 0)}</Text>
        </View>
      </View>

      {summary !== null && summary.sessions.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>まだ走行の記録がありません</Text>
        </View>
      ) : (
        <FlatList
          style={styles.list}
          data={summary?.sessions ?? []}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <View style={styles.rowInfo}>
                <Text style={styles.rowDate}>{formatDateTime(item.startedAt)}</Text>
                <Text style={styles.rowDetail}>
                  {formatDuration(item.durationMs)} ・ {formatDistance(item.distanceM)}
                </Text>
              </View>
              <Pressable onPress={() => handleDelete(item.id)} hitSlop={8}>
                <Text style={styles.deleteLabel}>削除</Text>
              </Pressable>
            </View>
          )}
        />
      )}

      <Link href="/record" asChild>
        <Pressable style={styles.startButton}>
          <Text style={styles.startButtonLabel}>記録を始める</Text>
        </Pressable>
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 16,
    paddingHorizontal: 16,
    backgroundColor: '#ffffff',
  },
  summary: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#cccccc',
  },
  summaryItem: {
    alignItems: 'center',
  },
  summaryLabel: {
    fontSize: 13,
    color: '#666666',
  },
  summaryValue: {
    fontSize: 24,
    fontWeight: '700',
    marginTop: 4,
  },
  list: {
    flex: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e0e0e0',
  },
  rowInfo: {
    flex: 1,
  },
  rowDate: {
    fontSize: 16,
    fontWeight: '600',
  },
  rowDetail: {
    fontSize: 14,
    color: '#666666',
    marginTop: 2,
  },
  deleteLabel: {
    fontSize: 14,
    color: '#cc3333',
    paddingLeft: 16,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: 15,
    color: '#666666',
  },
  startButton: {
    backgroundColor: '#1a73e8',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginVertical: 16,
  },
  startButtonLabel: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '700',
  },
});
