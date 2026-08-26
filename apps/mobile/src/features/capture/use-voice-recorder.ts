import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';

import type { LocalMedia } from './use-media-upload';

type VoiceRecorderOptions = {
  maxDurationSeconds?: number;
  onMaxDuration?: (media: LocalMedia, durationSeconds: number) => void;
};

function audioMedia(uri: string): LocalMedia {
  return {
    uri,
    kind: 'audio',
    contentType: Platform.OS === 'web' ? 'audio/webm' : 'audio/m4a',
  };
}

/**
 * 语音输入。
 *
 * 录音只在页面里进行，停止后拿到本地文件，用户点发送时才上传——
 * 边录边传会让「取消」变得没法解释：已经传上去的那半段算什么。
 */
export function useVoiceRecorder({ maxDurationSeconds, onMaxDuration }: VoiceRecorderOptions = {}) {
  const onMaxDurationRef = useRef(onMaxDuration);
  const startedRef = useRef(false);
  useEffect(() => {
    onMaxDurationRef.current = onMaxDuration;
  }, [onMaxDuration]);

  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [started, setStarted] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);

  const recorder = useAudioRecorder({
    ...RecordingPresets.HIGH_QUALITY,
    isMeteringEnabled: true,
  }, (status) => {
    // 只有原生计时自然结束时 startedRef 仍为 true；手动完成和取消会先置 false。
    if (!status.isFinished || !status.url || !startedRef.current) return;
    startedRef.current = false;
    setStarted(false);
    setPaused(false);
    void setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });
    onMaxDurationRef.current?.(audioMedia(status.url), maxDurationSeconds ?? 1);
  });
  const state = useAudioRecorderState(recorder);

  const start = async (): Promise<boolean> => {
    setError(null);
    setPermissionDenied(false);
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        setPermissionDenied(true);
        setError('未开启麦克风权限。');
        return false;
      }
      // 静音模式下也要能录，否则用户点击后没有明确反馈。
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
      await recorder.prepareToRecordAsync();
      recorder.record(maxDurationSeconds ? { forDuration: maxDurationSeconds } : undefined);
      startedRef.current = true;
      setStarted(true);
      setPaused(false);
      return true;
    } catch {
      setError('暂时无法开始录音，请重试。');
      return false;
    }
  };

  const pause = () => {
    if (!recorder.getStatus().isRecording) return;
    recorder.pause();
    setPaused(true);
  };

  const resume = () => {
    if (!started || !paused) return;
    const elapsedSeconds = Math.floor(recorder.getStatus().durationMillis / 1000);
    const remainingSeconds = maxDurationSeconds
      ? Math.max(1, maxDurationSeconds - elapsedSeconds)
      : undefined;
    recorder.record(remainingSeconds ? { forDuration: remainingSeconds } : undefined);
    setPaused(false);
  };

  /** 停止录音并返回可上传的文件。取消录音时调用 discard。 */
  const stop = async (): Promise<LocalMedia | null> => {
    if (!started) return null;
    try {
      startedRef.current = false;
      await recorder.stop();
      const uri = recorder.uri;
      setStarted(false);
      setPaused(false);
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });
      if (!uri) return null;
      return audioMedia(uri);
    } catch {
      setError('录音保存失败，请重新录制。');
      return null;
    }
  };

  const discard = async () => {
    if (!started) return;
    try {
      startedRef.current = false;
      await recorder.stop();
    } finally {
      setStarted(false);
      setPaused(false);
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });
    }
  };

  // 来电、切后台或系统收走音频会话时先暂停，避免用户回来后丢掉已录内容。
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active' && recorder.getStatus().isRecording) {
        recorder.pause();
        setPaused(true);
        setStarted(true);
      }
    });
    return () => subscription.remove();
  }, [recorder]);

  useEffect(
    () => () => {
      const status = recorder.getStatus();
      if (status.isRecording || status.canRecord) {
        startedRef.current = false;
        void recorder.stop().catch(() => undefined);
      }
    },
    [recorder],
  );

  return {
    start,
    pause,
    resume,
    stop,
    discard,
    recording: state.isRecording,
    paused,
    active: started,
    durationSeconds: Math.floor((state.durationMillis ?? 0) / 1000),
    metering: state.metering ?? -60,
    permissionDenied,
    error,
    clearError: () => {
      setError(null);
      setPermissionDenied(false);
    },
  };
}
