import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { useState } from 'react';

import type { LocalMedia } from './use-media-upload';

/**
 * 语音输入。
 *
 * 录音只在页面里进行，停止后拿到本地文件，用户点发送时才上传——
 * 边录边传会让「取消」变得没法解释：已经传上去的那半段算什么。
 */
export function useVoiceRecorder() {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const state = useAudioRecorderState(recorder);
  const [error, setError] = useState<string | null>(null);

  const start = async (): Promise<boolean> => {
    setError(null);
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) {
      setError('需要麦克风权限才能录音。');
      return false;
    }
    // 静音模式下也要能录，否则用户按了没反应还不知道为什么。
    await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
    return true;
  };

  /** 停止录音并返回可上传的文件。取消录音时调用 discard。 */
  const stop = async (): Promise<LocalMedia | null> => {
    await recorder.stop();
    if (!recorder.uri) return null;
    return {
      uri: recorder.uri,
      kind: 'audio',
      // HIGH_QUALITY 预设在两个平台上都产出 m4a。
      contentType: 'audio/m4a',
    };
  };

  const discard = async () => {
    if (state.isRecording) {
      await recorder.stop();
    }
  };

  return {
    start,
    stop,
    discard,
    recording: state.isRecording,
    durationSeconds: Math.floor((state.durationMillis ?? 0) / 1000),
    error,
    clearError: () => setError(null),
  };
}
