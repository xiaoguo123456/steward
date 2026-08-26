import * as Speech from 'expo-speech';
import { useCallback, useMemo } from 'react';

type AnnounceOptions = {
  interrupt?: boolean;
};

/**
 * 真机本地播报器。文案由确定性代码生成，避免运动中依赖网络或重复调用模型。
 */
export function useWorkoutVoice(enabled: boolean) {
  const announce = useCallback(
    async (text: string, options: AnnounceOptions = {}): Promise<void> => {
      if (!enabled || !text.trim()) return;
      if (options.interrupt !== false) {
        await Speech.stop().catch(() => undefined);
      }

      await new Promise<void>((resolve) => {
        let completed = false;
        let timeout: ReturnType<typeof setTimeout> | undefined;
        const finish = () => {
          if (completed) return;
          completed = true;
          if (timeout) clearTimeout(timeout);
          resolve();
        };
        timeout = setTimeout(finish, 8000);

        try {
          Speech.speak(text, {
            language: 'zh-CN',
            pitch: 1,
            rate: 0.92,
            onDone: finish,
            onError: finish,
            onStopped: finish,
          });
        } catch {
          finish();
        }
      });
    },
    [enabled],
  );

  const stop = useCallback(async () => {
    await Speech.stop().catch(() => undefined);
  }, []);

  return useMemo(() => ({ announce, stop }), [announce, stop]);
}
