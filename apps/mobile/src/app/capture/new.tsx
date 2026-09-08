import {
  errorMessage,
} from '@steward/api-client';
import NetInfo from '@react-native-community/netinfo';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { AppButton } from '@/components/ui/app-button';
import { AppIcon } from '@/components/ui/icon';
import { ModalSheet } from '@/components/ui/modal-sheet';
import { useCaptureAssistantSession } from '@/features/capture/capture-assistant-session';
import { useImagePicker } from '@/features/capture/use-media-picker';
import {
  deleteCaptureDraft,
  getCaptureDraft,
  persistDraftMedia,
  saveCaptureDraft,
} from '@/features/capture/capture-draft-store';
import {
  createCaptureDraft,
  draftSummary as summarizeDraft,
  type CaptureDraft,
  type CaptureDraftPart,
} from '@/features/capture/capture-draft-model';
import { processCaptureDraft } from '@/features/capture/capture-upload-queue';
import type { LocalMedia } from '@/features/capture/use-media-upload';
import { useVoiceRecorder } from '@/features/capture/use-voice-recorder';
import { session } from '@/api/session';
import { colors, fontFamily, radius, typography } from '@/theme/tokens';

type InputMode = 'text' | 'voice';
type ReplaceTarget = InputMode | null;

const MAX_RECORDING_SECONDS = 10 * 60;
const RECORDING_WARNING_SECONDS = 60;
const waveformPattern = [0.34, 0.58, 0.82, 0.46, 0.72, 1, 0.62, 0.4, 0.86, 0.54, 0.74, 0.38, 0.92, 0.64, 0.44, 0.78, 0.5];

function formatDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function VoiceWaveform({ active = false, compact = false, level = 0.5 }: {
  active?: boolean;
  compact?: boolean;
  level?: number;
}) {
  const maxHeight = compact ? 22 : 36;
  const strength = active ? Math.max(0.32, level) : 0.62;

  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.waveform, compact && styles.waveformCompact]}>
      {waveformPattern.map((height, index) => (
        <View
          key={index}
          style={[
            styles.waveformBar,
            compact && styles.waveformBarCompact,
            {
              height: Math.max(5, Math.round(maxHeight * height * strength)),
              backgroundColor: active ? colors.primaryStrong : colors.borderStrong,
            },
          ]}
        />
      ))}
    </View>
  );
}

export default function CaptureInputScreen() {
  const router = useRouter();
  const captureAssistant = useCaptureAssistantSession();
  const params = useLocalSearchParams<{ intent?: string; projectId?: string; draftId?: string }>();
  const isTripIntent = params.intent === 'trip';
  const isTripItemIntent = params.intent === 'trip_item';
  const isLedgerIntent = params.intent === 'ledger';
  const isTrackerIntent = params.intent === 'tracker';
  const [mode, setMode] = useState<InputMode>(isLedgerIntent || isTrackerIntent ? 'text' : 'voice');
  const [text, setText] = useState('');
  // 图片与录音只保存在本地，用户明确发送后才上传。
  const [images, setImages] = useState<CaptureDraftPart[]>([]);
  const [audio, setAudio] = useState<CaptureDraftPart | null>(null);
  const [audioDuration, setAudioDuration] = useState<number | null>(null);
  const [showMediaMenu, setShowMediaMenu] = useState(isLedgerIntent);
  const [showClosePrompt, setShowClosePrompt] = useState(false);
  const [showRerecordPrompt, setShowRerecordPrompt] = useState(false);
  const [replaceTarget, setReplaceTarget] = useState<ReplaceTarget>(null);
  const [finishingRecording, setFinishingRecording] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [draft, setDraft] = useState<CaptureDraft | null>(null);
  const hydrated = useRef(false);
  const everHadContent = useRef(false);

  const snapshot = useCallback((status: CaptureDraft['status']): CaptureDraft => {
    if (!draft) throw new Error('草稿尚未初始化');
    return {
      ...draft,
      status,
      mode,
      text,
      audioDuration: audioDuration ?? undefined,
      parts: [...images, ...(audio ? [audio] : [])].map((part, position) => ({
        ...part,
        position,
      })),
      error: undefined,
      updatedAt: new Date().toISOString(),
    };
  }, [audio, audioDuration, draft, images, mode, text]);

  const persistMedia = useCallback(async (
    item: LocalMedia,
    position: number,
  ): Promise<CaptureDraftPart> => {
    if (!draft) throw new Error('草稿尚未初始化');
    return persistDraftMedia(draft.accountId, draft.id, item, position);
  }, [draft]);

  const picker = useImagePicker();
  const recorder = useVoiceRecorder({
    maxDurationSeconds: MAX_RECORDING_SECONDS,
    onMaxDuration: (file, durationSeconds) => {
      void persistMedia(file, images.length).then((saved) => {
        setAudio(saved);
        setAudioDuration(durationSeconds);
      }).catch(() => setSubmitError('录音没能保存到草稿，请重新录制。'));
    },
  });
  const audioPlayer = useAudioPlayer(audio?.uri ?? null, { updateInterval: 100 });
  const playback = useAudioPlayerStatus(audioPlayer);

  const hasContent = Boolean(text.trim() || images.length || audio);
  const canSend = Boolean(draft) && hasContent && !recorder.active && !finishingRecording && !submitting;
  const remainingSeconds = MAX_RECORDING_SECONDS - recorder.durationSeconds;
  const recordingLevel = Math.max(0, Math.min(1, (recorder.metering + 60) / 60));

  const failure = submitError ?? picker.error ?? (recorder.permissionDenied ? null : recorder.error);

  useEffect(() => {
    const accountId = session.userId();
    if (!accountId) return;
    let cancelled = false;
    void (async () => {
      const existing = params.draftId
        ? await getCaptureDraft(accountId, params.draftId)
        : null;
      const initial = existing ?? createCaptureDraft(accountId, {
        mode: isLedgerIntent || isTrackerIntent ? 'text' : 'voice',
        intent: params.intent,
        projectId: params.projectId,
      });
      if (cancelled) return;
      setDraft(initial);
      setMode(initial.mode);
      setText(initial.text);
      setImages(initial.parts.filter((part) => part.kind === 'image'));
      setAudio(initial.parts.find((part) => part.kind === 'audio') ?? null);
      setAudioDuration(initial.audioDuration ?? null);
      everHadContent.current = Boolean(initial.text.trim() || initial.parts.length);
      hydrated.current = true;
    })().catch(() => setSubmitError('草稿暂时无法打开，请稍后重试。'));
    return () => { cancelled = true; };
  }, [isLedgerIntent, isTrackerIntent, params.draftId, params.intent, params.projectId]);

  useEffect(() => {
    if (hasContent) everHadContent.current = true;
    if (!hydrated.current || !draft || (!hasContent && !everHadContent.current) || submitting) return;
    const timer = setTimeout(() => {
      void saveCaptureDraft(draft.accountId, snapshot('editing'));
    }, 350);
    return () => clearTimeout(timer);
  }, [draft, hasContent, snapshot, submitting]);

  const stopPlayback = useCallback(async () => {
    audioPlayer.pause();
    if (playback.currentTime > 0) await audioPlayer.seekTo(0);
  }, [audioPlayer, playback.currentTime]);

  const finishRecording = async () => {
    if (!recorder.active || finishingRecording) return;
    setFinishingRecording(true);
    const seconds = Math.max(1, recorder.durationSeconds);
    const file = await recorder.stop();
    try {
      if (file) {
        const saved = await persistMedia(file, images.length);
        setAudio(saved);
        setAudioDuration(seconds);
      }
    } catch {
      setSubmitError('录音没能保存到草稿，请重新录制。');
    } finally {
      setFinishingRecording(false);
    }
  };

  const close = async () => {
    Keyboard.dismiss();
    if (recorder.active) {
      if (!recorder.paused) recorder.pause();
      setShowClosePrompt(true);
      return;
    }
    if (hasContent) {
      setShowClosePrompt(true);
      return;
    }
    if (draft) await deleteCaptureDraft(draft.accountId, draft.id);
    router.back();
  };

  const addImages = async (source: 'camera' | 'library') => {
    setShowMediaMenu(false);
    setSubmitError(null);
    const picked = await picker.pick(source);
    // 上限 9 张：再多的话一次 Capture 要处理的内容已经超出「记一件事」了。
    try {
      const available = Math.max(0, 9 - images.length);
      const saved: CaptureDraftPart[] = [];
      for (const [index, item] of picked.slice(0, available).entries()) {
        saved.push(await persistMedia(item, images.length + index));
      }
      setImages((current) => [...current, ...saved].slice(0, 9));
    } catch {
      setSubmitError('图片没能保存到草稿，请重新选择。');
    }
  };

  const requestMode = (nextMode: InputMode) => {
    if (nextMode === mode) return;
    Keyboard.dismiss();
    setShowMediaMenu(false);
    if (
      (nextMode === 'voice' && text.trim())
      || (nextMode === 'text' && (audio || recorder.active))
    ) {
      if (recorder.recording) recorder.pause();
      setReplaceTarget(nextMode);
      return;
    }
    recorder.clearError();
    setMode(nextMode);
  };

  const confirmModeReplacement = async () => {
    if (!replaceTarget) return;
    if (replaceTarget === 'voice') setText('');
    if (replaceTarget === 'text') {
      await stopPlayback();
      if (recorder.active) await recorder.discard();
      setAudio(null);
      setAudioDuration(null);
    }
    recorder.clearError();
    setMode(replaceTarget);
    setReplaceTarget(null);
  };

  const startRecording = async () => {
    if (recorder.active || audio) return;
    setSubmitError(null);
    setShowMediaMenu(false);
    await recorder.start();
  };

  const cancelRecording = async () => {
    await recorder.discard();
    recorder.clearError();
    setAudio(null);
    setAudioDuration(null);
  };

  const togglePlayback = async () => {
    if (!audio) return;
    if (playback.playing) {
      audioPlayer.pause();
      return;
    }
    await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });
    if (
      playback.didJustFinish
      || (playback.duration > 0 && playback.currentTime >= playback.duration - 0.1)
    ) {
      await audioPlayer.seekTo(0);
    }
    audioPlayer.play();
  };

  const deleteAudio = async () => {
    await stopPlayback();
    setAudio(null);
    setAudioDuration(null);
  };

  const confirmRerecord = async () => {
    setShowRerecordPrompt(false);
    await deleteAudio();
    setSubmitError(null);
    setShowMediaMenu(false);
    await recorder.start();
  };

  const submit = async () => {
    if (!canSend || submitting) return;
    Keyboard.dismiss();
    audioPlayer.pause();

    setSubmitError(null);
    setSubmitting(true);
    try {
      if (!draft) throw new Error('草稿尚未初始化');
      const network = await NetInfo.fetch();
      const online = network.isConnected === true && network.isInternetReachable !== false;
      const queued = snapshot(online ? 'ready_for_upload' : 'waiting_for_network');
      await saveCaptureDraft(draft.accountId, queued);
      setDraft(queued);
      if (!online) {
        router.replace('/settings/captures');
        return;
      }
      const submitted = await processCaptureDraft(draft.accountId, draft.id);
      if (!submitted.captureId) throw new Error('服务端没有返回 Capture 引用');
      const assistantSession = {
        captureId: submitted.captureId,
        operationId: submitted.operationId ?? '',
        draft: summarizeDraft(submitted),
        intent: isTripIntent
          ? 'trip'
          : isTripItemIntent
            ? 'trip_item'
            : isLedgerIntent
              ? 'ledger'
              : isTrackerIntent ? 'tracker' : undefined,
        projectId: isTripItemIntent ? params.projectId : undefined,
      };
      captureAssistant.openSession(assistantSession);
      router.replace({
        pathname: '/ai',
        params: assistantSession,
      });
    } catch (error) {
      const network = await NetInfo.fetch().catch(() => null);
      if (draft && network?.isConnected === false) {
        const waiting = snapshot('waiting_for_network');
        await saveCaptureDraft(draft.accountId, waiting);
        setDraft(waiting);
      }
      setSubmitError(errorMessage(error, '提交未完成，已保留在“最近输入”中。'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalSheet maxHeight="86%" onClose={() => void close()}>
      <View style={styles.header}>
        <Text accessibilityRole="header" style={styles.title}>
          {isTripIntent
            ? 'AI 创建行程'
            : isTripItemIntent
              ? 'AI 添加行程安排'
              : isLedgerIntent
                ? '拍照记账'
                : isTrackerIntent ? '新建打卡' : '记一件事'}
        </Text>
        <Pressable
          accessibilityLabel="关闭新增面板"
          accessibilityRole="button"
          onPress={() => void close()}
          style={({ pressed }) => [styles.closeButton, pressed && styles.iconPressed]}
        >
          <AppIcon name="close" size={23} />
        </Pressable>
      </View>

      <View style={styles.body}>
        {images.length ? (
          <ScrollView
            contentContainerStyle={styles.imageList}
            horizontal
            showsHorizontalScrollIndicator={false}
          >
            {images.map((image, index) => (
              <View key={`${image.uri}-${index}`} style={styles.imagePreview}>
                <Image contentFit="cover" source={{ uri: image.uri }} style={styles.imageThumb} />
                <View style={styles.imageIndex}>
                  <Text style={styles.imageIndexText}>{index + 1}</Text>
                </View>
                <Pressable
                  accessibilityLabel={`删除图片 ${index + 1}`}
                  accessibilityRole="button"
                  hitSlop={9}
                  onPress={() => setImages((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                  style={styles.removeImage}
                >
                  <AppIcon color={colors.background} name="close" size={13} />
                </Pressable>
              </View>
            ))}
          </ScrollView>
        ) : null}

        {mode === 'voice' ? (
          recorder.active ? (
            <View style={styles.recordingPanel}>
              <View style={styles.recordingStatus}>
                <View style={[styles.recordingDot, recorder.paused && styles.recordingDotPaused]} />
                <Text style={styles.recordingLabel}>{recorder.paused ? '已暂停' : '正在录音'}</Text>
                <Text accessibilityLabel={`录音时长 ${formatDuration(recorder.durationSeconds)}`} style={styles.recordingTime}>
                  {formatDuration(recorder.durationSeconds)}
                </Text>
              </View>
              <VoiceWaveform active={!recorder.paused} level={recordingLevel} />
              {remainingSeconds <= RECORDING_WARNING_SECONDS ? (
                <Text style={styles.recordingWarning}>还可录 {formatDuration(Math.max(remainingSeconds, 0))}</Text>
              ) : null}
              <View style={styles.recordingActions}>
                <Pressable
                  accessibilityLabel="取消录音"
                  accessibilityRole="button"
                  onPress={() => void cancelRecording()}
                  style={({ pressed }) => [styles.recordingAction, pressed && styles.optionPressed]}
                >
                  <View style={styles.recordingActionIcon}>
                    <AppIcon color={colors.textSecondary} name="close" size={21} />
                  </View>
                  <Text style={styles.recordingActionText}>取消</Text>
                </Pressable>
                <Pressable
                  accessibilityLabel={recorder.paused ? '继续录音' : '暂停录音'}
                  accessibilityRole="button"
                  onPress={recorder.paused ? recorder.resume : recorder.pause}
                  style={({ pressed }) => [styles.pauseButton, pressed && styles.primaryPressed]}
                >
                  <AppIcon color={colors.background} name={recorder.paused ? 'mic' : 'pause'} size={27} />
                </Pressable>
                <Pressable
                  accessibilityLabel="完成录音"
                  accessibilityRole="button"
                  onPress={() => void finishRecording()}
                  style={({ pressed }) => [styles.recordingAction, pressed && styles.optionPressed]}
                >
                  <View style={styles.recordingActionIcon}>
                    <AppIcon color={colors.primaryStrong} name="checkmark" size={22} />
                  </View>
                  <Text style={styles.recordingActionText}>完成</Text>
                </Pressable>
              </View>
            </View>
          ) : audio && audioDuration ? (
            <View style={styles.audioPreview}>
              <Pressable
                accessibilityLabel={playback.playing ? '暂停试听录音' : '试听录音'}
                accessibilityRole="button"
                onPress={() => void togglePlayback()}
                style={({ pressed }) => [styles.playButton, pressed && styles.primaryPressed]}
              >
                <AppIcon color={colors.background} name={playback.playing ? 'pause' : 'play'} size={21} />
              </Pressable>
              <View style={styles.audioCopy}>
                <View style={styles.audioTitleRow}>
                  <Text style={styles.audioTitle}>{playback.playing ? '正在播放' : '语音已录好'}</Text>
                  <Text style={styles.audioMeta}>{formatDuration(audioDuration)}</Text>
                </View>
                <VoiceWaveform active={playback.playing} compact level={0.72} />
              </View>
              <Pressable
                accessibilityLabel="重新录制"
                accessibilityRole="button"
                onPress={() => setShowRerecordPrompt(true)}
                style={({ pressed }) => [styles.smallIconButton, pressed && styles.iconPressed]}
              >
                <AppIcon color={colors.textSecondary} name="refresh" size={19} />
              </Pressable>
              <Pressable
                accessibilityLabel="删除录音"
                accessibilityRole="button"
                onPress={() => void deleteAudio()}
                style={({ pressed }) => [styles.smallIconButton, pressed && styles.iconPressed]}
              >
                <AppIcon color={colors.textSecondary} name="trash-outline" size={19} />
              </Pressable>
            </View>
          ) : (
            <View style={styles.voiceIdle}>
              <Pressable
                accessibilityLabel="开始录音"
                accessibilityRole="button"
                onPress={() => void startRecording()}
                style={({ pressed }) => [styles.micButton, pressed && styles.micButtonPressed]}
              >
                <AppIcon color={colors.background} name="mic" size={36} />
              </Pressable>
              <Text style={styles.micLabel}>点击说话</Text>
            </View>
          )
        ) : (
          <TextInput
            accessibilityLabel="输入要整理的内容"
            autoFocus
            maxLength={10000}
            multiline
            onChangeText={setText}
            placeholder={isTrackerIntent ? '例如：每天阅读，记录阅读分钟数和页数…' : isTripIntent ? '输入行程安排…' : '输入任务、日程、想法或记录…'}
            placeholderTextColor={colors.textSecondary}
            style={styles.textInput}
            textAlignVertical="top"
            value={text}
          />
        )}
      </View>

      {showMediaMenu ? (
        <View style={styles.mediaMenu}>
          <Pressable
            accessibilityLabel="拍照"
            accessibilityRole="button"
            onPress={() => void addImages('camera')}
            style={({ pressed }) => [styles.mediaAction, pressed && styles.optionPressed]}
          >
            <View style={styles.mediaIcon}>
              <AppIcon color={colors.primaryStrong} name="camera-outline" size={21} />
            </View>
            <Text style={styles.mediaLabel}>拍照</Text>
          </Pressable>
          <Pressable
            accessibilityLabel="从相册选择"
            accessibilityRole="button"
            onPress={() => void addImages('library')}
            style={({ pressed }) => [styles.mediaAction, pressed && styles.optionPressed]}
          >
            <View style={styles.mediaIcon}>
              <AppIcon color={colors.primaryStrong} name="images-outline" size={21} />
            </View>
            <Text style={styles.mediaLabel}>从相册选择</Text>
          </Pressable>
        </View>
      ) : null}

      {recorder.permissionDenied ? (
        <View style={styles.permissionRow}>
          <Text style={styles.permissionText}>未开启麦克风权限</Text>
          <Pressable accessibilityRole="button" onPress={() => void Linking.openSettings()} style={styles.permissionAction}>
            <Text style={styles.permissionActionText}>去设置</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => requestMode('text')} style={styles.permissionAction}>
            <Text style={styles.permissionActionText}>用键盘</Text>
          </Pressable>
        </View>
      ) : null}

      {!recorder.active ? (
        <View style={styles.footer}>
          {failure ? <Text style={styles.submitError}>{failure}</Text> : null}
          {images.length || audio ? (
            <Text style={styles.mediaNotice}>发送后上传，整理结果需你确认。</Text>
          ) : null}
          <View style={styles.inputOptions}>
            <Pressable
              accessibilityLabel={isTripItemIntent || isLedgerIntent ? '添加票据图片' : '添加图片'}
              accessibilityRole="button"
              accessibilityState={{ disabled: images.length >= 9 }}
              disabled={images.length >= 9}
              onPress={() => setShowMediaMenu((current) => !current)}
              style={({ pressed }) => [styles.inputOption, pressed && styles.optionPressed, images.length >= 9 && styles.optionDisabled]}
            >
              <AppIcon color={colors.primaryStrong} name="image-outline" size={20} />
              <Text style={styles.inputOptionText}>{isTripItemIntent || isLedgerIntent ? '票据' : '图片'}</Text>
            </Pressable>
            <Pressable
              accessibilityLabel={mode === 'text' ? '切换到语音输入' : '切换到文字输入'}
              accessibilityRole="button"
              onPress={() => requestMode(mode === 'text' ? 'voice' : 'text')}
              style={({ pressed }) => [styles.inputOption, pressed && styles.optionPressed]}
            >
              <AppIcon color={colors.primaryStrong} name={mode === 'text' ? 'mic-outline' : 'keypad-outline'} size={20} />
              <Text style={styles.inputOptionText}>{mode === 'text' ? '语音' : '键盘'}</Text>
            </Pressable>
            {!hasContent && !isTripIntent && !isTripItemIntent && !isLedgerIntent ? (
              <Pressable
                accessibilityLabel={isTrackerIntent ? '手动新建打卡' : '手动新建任务'}
                accessibilityRole="button"
                onPress={() => isTrackerIntent ? router.back() : router.replace('/tasks/new')}
                style={({ pressed }) => [styles.inputOption, pressed && styles.optionPressed]}
              >
                <AppIcon color={colors.primaryStrong} name="create-outline" size={20} />
                <Text style={styles.inputOptionText}>{isTrackerIntent ? '自己填写' : '新建任务'}</Text>
              </Pressable>
            ) : null}
          </View>
          {hasContent ? (
            <AppButton
              disabled={!canSend}
              label={submitting ? '正在提交…' : '发送并整理'}
              onPress={() => void submit()}
            />
          ) : null}
        </View>
      ) : null}

      {showClosePrompt ? (
        <View style={styles.confirmOverlay}>
          <Pressable onPress={() => setShowClosePrompt(false)} style={styles.confirmBackdrop} />
          <View style={styles.confirmSheet}>
            <Text style={styles.confirmTitle}>保留这次输入？</Text>
            <Text style={styles.confirmCopy}>可以保存为仅当前账号可见的设备草稿，稍后继续。</Text>
            <AppButton
              label="保存草稿并返回"
              onPress={async () => {
                if (!draft) return;
                await saveCaptureDraft(draft.accountId, snapshot('editing'));
                router.back();
              }}
            />
            <AppButton
              label="放弃并返回"
              onPress={async () => {
                if (recorder.active) void recorder.discard();
                if (draft) await deleteCaptureDraft(draft.accountId, draft.id);
                router.back();
              }}
              variant="danger"
            />
            <AppButton label="继续编辑" onPress={() => setShowClosePrompt(false)} variant="text" />
          </View>
        </View>
      ) : null}

      {replaceTarget ? (
        <View style={styles.confirmOverlay}>
          <Pressable onPress={() => setReplaceTarget(null)} style={styles.confirmBackdrop} />
          <View style={styles.confirmSheet}>
            <Text style={styles.confirmTitle}>
              {replaceTarget === 'voice' ? '改用语音输入？' : '改用文字输入？'}
            </Text>
            <Text style={styles.confirmCopy}>
              {replaceTarget === 'voice' ? '当前文字会被清除。' : '当前录音会被清除。'}
            </Text>
            <AppButton label="确认替换" onPress={() => void confirmModeReplacement()} />
            <AppButton label="取消" onPress={() => setReplaceTarget(null)} variant="text" />
          </View>
        </View>
      ) : null}

      {showRerecordPrompt ? (
        <View style={styles.confirmOverlay}>
          <Pressable onPress={() => setShowRerecordPrompt(false)} style={styles.confirmBackdrop} />
          <View style={styles.confirmSheet}>
            <Text style={styles.confirmTitle}>重新录制？</Text>
            <Text style={styles.confirmCopy}>当前录音会被替换。</Text>
            <AppButton label="重新录制" onPress={() => void confirmRerecord()} />
            <AppButton label="取消" onPress={() => setShowRerecordPrompt(false)} variant="text" />
          </View>
        </View>
      ) : null}
    </ModalSheet>
  );
}

const styles = StyleSheet.create({
  header: {
    minHeight: 58,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    color: colors.text,
    fontFamily,
    ...typography.section,
  },
  closeButton: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconPressed: {
    backgroundColor: colors.surface,
  },
  primaryPressed: {
    opacity: 0.84,
    transform: [{ scale: 0.97 }],
  },
  optionPressed: {
    backgroundColor: colors.primarySoft,
  },
  body: {
    paddingHorizontal: 16,
    paddingTop: 6,
  },
  imageList: {
    paddingBottom: 12,
    gap: 10,
  },
  imagePreview: {
    width: 76,
    height: 76,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
  },
  imageThumb: {
    width: '100%',
    height: '100%',
    borderRadius: radius.md,
  },
  imageIndex: {
    position: 'absolute',
    left: 6,
    bottom: 6,
    minWidth: 20,
    height: 20,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  imageIndexText: {
    color: colors.background,
    fontFamily,
    ...typography.caption,
  },
  removeImage: {
    position: 'absolute',
    top: 5,
    right: 5,
    width: 26,
    height: 26,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.text,
  },
  voiceIdle: {
    minHeight: 168,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micButton: {
    width: 82,
    height: 82,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  micButtonPressed: {
    opacity: 0.86,
    transform: [{ scale: 0.96 }],
  },
  micLabel: {
    marginTop: 12,
    color: colors.text,
    fontFamily,
    ...typography.bodyStrong,
  },
  recordingPanel: {
    minHeight: 214,
    paddingTop: 12,
    justifyContent: 'space-between',
  },
  recordingStatus: {
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordingDot: {
    width: 8,
    height: 8,
    marginRight: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.danger,
  },
  recordingDotPaused: {
    backgroundColor: colors.warning,
  },
  recordingLabel: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.label,
  },
  recordingTime: {
    minWidth: 58,
    marginLeft: 10,
    color: colors.text,
    fontFamily,
    ...typography.bodyStrong,
    fontVariant: ['tabular-nums'],
  },
  waveform: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  waveformCompact: {
    minHeight: 24,
    justifyContent: 'flex-start',
    gap: 3,
  },
  waveformBar: {
    width: 4,
    borderRadius: radius.pill,
  },
  waveformBarCompact: {
    width: 3,
  },
  recordingWarning: {
    color: colors.warning,
    fontFamily,
    ...typography.meta,
    textAlign: 'center',
  },
  recordingActions: {
    paddingHorizontal: 24,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  recordingAction: {
    width: 64,
    minHeight: 68,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordingActionIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  recordingActionText: {
    marginTop: 4,
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  pauseButton: {
    width: 66,
    height: 66,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  audioPreview: {
    minHeight: 84,
    paddingHorizontal: 10,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
  },
  playButton: {
    width: 46,
    height: 46,
    marginRight: 10,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  audioCopy: {
    flex: 1,
    minWidth: 88,
  },
  audioTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  audioTitle: {
    color: colors.text,
    fontFamily,
    ...typography.label,
    fontWeight: '600',
  },
  audioMeta: {
    marginLeft: 8,
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
    fontVariant: ['tabular-nums'],
  },
  smallIconButton: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textInput: {
    minHeight: 132,
    maxHeight: 210,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: radius.md,
    color: colors.text,
    backgroundColor: colors.surfaceSubtle,
    fontFamily,
    ...typography.input,
  },
  mediaMenu: {
    marginHorizontal: 16,
    marginTop: 10,
    padding: 6,
    flexDirection: 'row',
    gap: 6,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSubtle,
  },
  mediaAction: {
    minHeight: 54,
    flex: 1,
    paddingHorizontal: 10,
    borderRadius: radius.sm,
    flexDirection: 'row',
    alignItems: 'center',
  },
  mediaIcon: {
    width: 38,
    height: 38,
    marginRight: 9,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  mediaLabel: {
    color: colors.text,
    fontFamily,
    ...typography.label,
  },
  permissionRow: {
    minHeight: 48,
    marginHorizontal: 16,
    marginTop: 8,
    paddingLeft: 12,
    paddingRight: 4,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.dangerSoft,
  },
  permissionText: {
    flex: 1,
    color: colors.danger,
    fontFamily,
    ...typography.meta,
  },
  permissionAction: {
    minWidth: 56,
    minHeight: 44,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  permissionActionText: {
    color: colors.primaryStrong,
    fontFamily,
    ...typography.meta,
    fontWeight: '600',
  },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    gap: 10,
  },
  inputOptions: {
    flexDirection: 'row',
    gap: 10,
  },
  inputOption: {
    minHeight: 48,
    flex: 1,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    backgroundColor: colors.surface,
  },
  inputOptionText: {
    color: colors.text,
    fontFamily,
    ...typography.label,
    fontWeight: '600',
  },
  optionDisabled: {
    opacity: 0.42,
  },
  mediaNotice: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
    textAlign: 'center',
  },
  submitError: {
    color: colors.danger,
    fontFamily,
    ...typography.meta,
    textAlign: 'center',
  },
  confirmOverlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 30,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(16, 30, 25, 0.18)',
  },
  confirmBackdrop: {
    ...StyleSheet.absoluteFill,
  },
  confirmSheet: {
    padding: 20,
    paddingBottom: 24,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    backgroundColor: colors.background,
    gap: 8,
  },
  confirmTitle: {
    color: colors.text,
    fontFamily,
    ...typography.section,
  },
  confirmCopy: {
    marginBottom: 8,
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
});
