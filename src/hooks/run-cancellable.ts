/**
 * 画面を離れた後に setState が走らないよう、非同期処理をキャンセル可能な形で実行する。
 * `useEffect` / `useFocusEffect` のセットアップ関数から呼び、返り値をそのままクリーンアップに使う。
 * 失敗時はキャンセルされていない場合に限り `onError` でログへ出す。
 */
export function runCancellable(
  run: (isCancelled: () => boolean) => Promise<void>,
  onError: (error: unknown) => void,
): () => void {
  let cancelled = false;
  run(() => cancelled).catch((error) => {
    if (!cancelled) onError(error);
  });
  return () => {
    cancelled = true;
  };
}
