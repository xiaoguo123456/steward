import {
  createCapture,
  errorMessage,
  type CreateCaptureRequest,
} from '@steward/api-client';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  Keyboard,
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
import { useImagePicker } from '@/features/capture/use-media-picker';
import { useMediaUpload, type LocalMedia } from '@/features/capture/use-media-upload';
import { useVoiceRecorder } from '@/features/capture/use-voice-recorder';
import { colors, fontFamily, radius, typography } from '@/theme/tokens';

type InputMode = 'text' | 'voice';
type ReplaceTarget = InputMode | null;

export default function CaptureInputScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ intent?: string }>();
  const isTripIntent = params.intent === 'trip';
  const [mode, setMode] = useState<InputMode>('text');
  const [text, setText] = useState('');
  // 图片与录音是真实的本地文件，用户点发送时才上传。
  const [images, setImages] = useState<LocalMedia[]>([]);
  const [audio, setAudio] = useState<LocalMedia | null>(null);
  const [audioDuration, setAudioDuration] = useState<number | null>(null);
  const [showMediaMenu, setShowMediaMenu] = useState(false);
  const [showClosePrompt, setShowClosePrompt] = useState(false);
  const [replaceTarget, setReplaceTarget] = useState<ReplaceTarget>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const picker = useImagePicker();
  const recorder = useVoiceRecorder();
  const media = useMediaUpload();

  const recording = recorder.recording;
  const hasContent = Boolean(text.trim() || images.length || audio);
  const canSend = hasContent && !recording && !submitting;

  const draftSummary = useMemo(() => {
    if (text.trim()) return text.trim();
    if (audioDuration) return `语音输入 ${audioDuration} 秒`;
    return `${images.length} 张图片`;
  }, [audioDuration, images.length, text]);

  const failure = submitError ?? picker.error ?? recorder.error;

  const close = () => {
    Keyboard.dismiss();
    if (hasContent) {
      setShowClosePrompt(true);
      return;
    }
    router.back();
  };

  const addImages = async (source: 'camera' | 'library') => {
    setShowMediaMenu(false);
    setSubmitError(null);
    const picked = await picker.pick(source);
    // 上限 9 张：再多的话一次 Capture 要处理的内容已经超出「记一件事」了。
    setImages((current) => [...current, ...picked].slice(0, 9));
  };

  const requestMode = (nextMode: InputMode) => {
    if (nextMode === mode) return;
    if ((nextMode === 'voice' && text.trim()) || (nextMode === 'text' && audio)) {
      setReplaceTarget(nextMode);
      return;
    }
    setMode(nextMode);
  };

  const confirmModeReplacement = () => {
    if (!replaceTarget) return;
    if (replaceTarget === 'voice') setText('');
    if (replaceTarget === 'text') {
      setAudio(null);
      setAudioDuration(null);
    }
    setMode(replaceTarget);
    setReplaceTarget(null);
  };

  const startRecording = () => {
    setSubmitError(null);
    void recorder.start();
  };

  const finishRecording = async () => {
    if (!recording) return;
    // 先把时长记下来：stop 之后 state 会归零。
    const seconds = Math.max(1, recorder.durationSeconds);
    const file = await recorder.stop();
    if (!file) return;
    setAudio(file);
    setAudioDuration(seconds);
  };

  const submit = async () => {
    if (!canSend || submitting) return;
    Keyboard.dismiss();

    const content = text.trim();
    setSubmitError(null);
    setSubmitting(true);
    try {
      // 先把媒体传上去：Capture 只能引用已经确认上传的资产。
      const files = [...images, ...(audio ? [audio] : [])];
      const uploaded = await media.upload(files);

      // parts 的顺序就是用户看到的顺序，服务端按 position 保留它。
      const parts: CreateCaptureRequest['parts'] = [];
      if (isTripIntent) {
        parts.push({
          kind: 'text',
          text: content ? `创建行程：${content}` : '创建行程。',
        });
      } else if (content) {
        parts.push({ kind: 'text', text: content });
      }
      for (const item of uploaded) {
        parts.push({ kind: item.kind, media_id: item.mediaId });
      }

      const response = await createCapture({
        origin: isTripIntent ? 'project_manager' : 'home',
        parts,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      router.replace({
        pathname: '/capture/processing',
        params: {
          captureId: response.data.resource_id ?? '',
          operationId: response.data.operation_id,
          draft: draftSummary,
          intent: isTripIntent ? 'trip' : undefined,
        },
      });
    } catch (error) {
      setSubmitError(errorMessage(error, '提交失败，请稍后重试。'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalSheet maxHeight="86%" onClose={close}>
      <View style={styles.header}>
        <View>
          <Text accessibilityRole="header" style={styles.title}>
            {isTripIntent ? 'AI 创建行程' : '记一件事'}
          </Text>
          {!isTripIntent ? (
            <Text style={styles.subtitle}>AI 会先整理，确认后再保存</Text>
          ) : null}
        </View>
        <Pressable
          accessibilityLabel="关闭新增面板"
          accessibilityRole="button"
          onPress={close}
          style={({ pressed }) => [styles.closeButton, pressed && styles.iconPressed]}
        >
          <AppIcon name="close" size={23} />
        </Pressable>
      </View>

      {!isTripIntent ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.replace('/capture/new')}
          style={({ pressed }) => [styles.recentRow, pressed && styles.recentPressed]}
        >
          <View style={styles.recentIcon}>
            <AppIcon color={colors.primaryStrong} name="time-outline" size={18} />
          </View>
          <View style={styles.recentCopy}>
            <Text style={styles.recentTitle}>最近输入</Text>
            <Text style={styles.recentMeta}>1 项等待确认</Text>
          </View>
          <Text style={styles.continueText}>继续</Text>
          <AppIcon color={colors.borderStrong} name="chevron-forward" size={16} />
        </Pressable>
      ) : null}

      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
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
                  onPress={() => setImages((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                  style={styles.removeImage}
                >
                  <AppIcon color={colors.background} name="close" size={13} />
                </Pressable>
              </View>
            ))}
          </ScrollView>
        ) : null}

        {audioDuration ? (
          <View style={styles.audioPreview}>
            <View style={styles.audioIcon}>
              <AppIcon color={colors.primaryStrong} name="mic" size={19} />
            </View>
            <View style={styles.audioCopy}>
              <Text style={styles.audioTitle}>语音已录好</Text>
              <Text style={styles.audioMeta}>{audioDuration} 秒 · 发送后自动转写</Text>
            </View>
            <Pressable
              accessibilityLabel="删除录音"
              onPress={() => {
                setAudio(null);
                setAudioDuration(null);
              }}
              style={({ pressed }) => [styles.smallIconButton, pressed && styles.iconPressed]}
            >
              <AppIcon color={colors.textSecondary} name="trash-outline" size={18} />
            </Pressable>
          </View>
        ) : null}

        {!images.length && !audioDuration ? (
          <View style={styles.promptSpace}>
            <Text style={styles.promptTitle}>
              {isTripIntent ? '说出目的地和日期' : '可以说得随意一点'}
            </Text>
            <Text style={styles.promptCopy}>
              {isTripIntent
                ? '例如：8 月 29 日至 31 日去北京，和爸妈一起'
                : '例如：下周二下午提醒我准备产品评审'}
            </Text>
          </View>
        ) : null}
      </ScrollView>

      {showMediaMenu ? (
        <View style={styles.mediaMenu}>
          <Pressable
            accessibilityLabel="拍照"
            accessibilityRole="button"
            onPress={() => void addImages('camera')}
            style={({ pressed }) => [styles.mediaAction, pressed && styles.mediaPressed]}
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
            style={({ pressed }) => [styles.mediaAction, pressed && styles.mediaPressed]}
          >
            <View style={styles.mediaIcon}>
              <AppIcon color={colors.primaryStrong} name="images-outline" size={21} />
            </View>
            <Text style={styles.mediaLabel}>从相册选择</Text>
          </Pressable>
        </View>
      ) : null}

      {images.length || audioDuration ? (
        <Text style={styles.mediaNotice}>
          图片或录音只用于整理这次输入；识别结果仍需你确认后才会保存
        </Text>
      ) : null}

      <View style={styles.composerWrap}>
        {failure ? <Text style={styles.submitError}>{failure}</Text> : null}
        {media.uploading ? (
          <Text style={styles.uploadHint}>正在上传媒体…</Text>
        ) : null}
        <View style={styles.composer}>
          <Pressable
            accessibilityLabel="添加图片"
            accessibilityRole="button"
            onPress={() => setShowMediaMenu((current) => !current)}
            style={({ pressed }) => [styles.composerButton, pressed && styles.iconPressed]}
          >
            <AppIcon color={colors.text} name="add-circle-outline" size={25} />
          </Pressable>

          {mode === 'text' ? (
            <TextInput
              accessibilityLabel="输入要整理的内容"
              multiline
              onChangeText={setText}
              placeholder={isTripIntent ? '输入行程安排…' : '输入任务、日程、想法或记录…'}
              placeholderTextColor={colors.textTertiary}
              style={styles.input}
              value={text}
            />
          ) : (
            <Pressable
              accessibilityLabel={recording ? '正在录音，松开完成' : '按住说话'}
              accessibilityRole="button"
              onPressIn={startRecording}
              onPressOut={() => void finishRecording()}
              style={({ pressed }) => [styles.voiceInput, pressed && styles.voicePressed]}
            >
              <Text style={[styles.voiceText, recording && styles.recordingText]}>
                {recording
                  ? `正在录音 ${recorder.durationSeconds} 秒，松开完成`
                  : '按住说话'}
              </Text>
            </Pressable>
          )}

          <Pressable
            accessibilityLabel={mode === 'text' ? '切换到语音输入' : '切换到文字输入'}
            accessibilityRole="button"
            onPress={() => requestMode(mode === 'text' ? 'voice' : 'text')}
            style={({ pressed }) => [styles.composerButton, pressed && styles.iconPressed]}
          >
            <AppIcon
              color={colors.textSecondary}
              name={mode === 'text' ? 'mic-outline' : 'text-outline'}
              size={22}
            />
          </Pressable>
          <Pressable
            accessibilityLabel="发送并整理"
            accessibilityRole="button"
            accessibilityState={{ disabled: !canSend }}
            disabled={!canSend || submitting}
            onPress={() => void submit()}
            style={({ pressed }) => [
              styles.sendButton,
              (!canSend || submitting) && styles.sendDisabled,
              pressed && canSend && styles.sendPressed,
            ]}
          >
            <AppIcon
              color={canSend ? colors.background : colors.textSecondary}
              name="arrow-up"
              size={20}
            />
          </Pressable>
        </View>
      </View>

      {showClosePrompt ? (
        <View style={styles.confirmOverlay}>
          <Pressable onPress={() => setShowClosePrompt(false)} style={styles.confirmBackdrop} />
          <View style={styles.confirmSheet}>
            <Text style={styles.confirmTitle}>保留这次输入吗？</Text>
            <Text style={styles.confirmCopy}>保存草稿后，可以从“最近输入”继续。</Text>
            <AppButton label="保存草稿" onPress={() => router.back()} />
            <AppButton label="放弃输入" onPress={() => router.back()} variant="danger" />
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
              {replaceTarget === 'voice'
                ? '开始录音会清除当前文字。'
                : '输入文字会清除当前录音。'}
            </Text>
            <AppButton label="确认替换" onPress={confirmModeReplacement} />
            <AppButton label="取消" onPress={() => setReplaceTarget(null)} variant="text" />
          </View>
        </View>
      ) : null}
    </ModalSheet>
  );
}

const styles = StyleSheet.create({
  submitError: {
    marginBottom: 8,
    color: colors.danger,
    fontFamily,
    fontSize: 13,
    lineHeight: 19,
  },
  header: {
    minHeight: 64,
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
  subtitle: {
    marginTop: 2,
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
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
  recentRow: {
    minHeight: 60,
    marginHorizontal: 16,
    paddingHorizontal: 12,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceSubtle,
  },
  recentPressed: {
    backgroundColor: colors.primarySoft,
  },
  recentIcon: {
    width: 34,
    height: 34,
    marginRight: 10,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  recentCopy: {
    flex: 1,
  },
  recentTitle: {
    color: colors.text,
    fontFamily,
    ...typography.label,
    fontWeight: '600',
  },
  recentMeta: {
    marginTop: 1,
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  continueText: {
    marginRight: 3,
    color: colors.primaryStrong,
    fontFamily,
    ...typography.meta,
    fontWeight: '600',
  },
  body: {
    minHeight: 128,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  promptSpace: {
    minHeight: 104,
    alignItems: 'center',
    justifyContent: 'center',
  },
  promptTitle: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.bodyStrong,
  },
  promptCopy: {
    marginTop: 6,
    color: colors.textTertiary,
    fontFamily,
    ...typography.meta,
  },
  imageList: {
    gap: 10,
  },
  imagePreview: {
    width: 82,
    height: 82,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primarySoft,
  },
  imageThumb: {
    width: '100%',
    height: '100%',
    borderRadius: radius.md,
  },
  uploadHint: {
    marginBottom: 8,
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
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
    width: 24,
    height: 24,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.text,
  },
  audioPreview: {
    minHeight: 68,
    paddingHorizontal: 12,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
  },
  audioIcon: {
    width: 38,
    height: 38,
    marginRight: 11,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  audioCopy: {
    flex: 1,
  },
  audioTitle: {
    color: colors.text,
    fontFamily,
    ...typography.label,
    fontWeight: '600',
  },
  audioMeta: {
    marginTop: 2,
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  smallIconButton: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mediaMenu: {
    marginHorizontal: 16,
    padding: 8,
    flexDirection: 'row',
    gap: 8,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceSubtle,
  },
  mediaAction: {
    minHeight: 56,
    flex: 1,
    paddingHorizontal: 10,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
  },
  mediaPressed: {
    backgroundColor: colors.primarySoft,
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
  mediaNotice: {
    marginTop: 8,
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
    textAlign: 'center',
  },
  composerWrap: {
    padding: 12,
    paddingTop: 8,
  },
  composer: {
    minHeight: 56,
    paddingLeft: 3,
    paddingRight: 5,
    borderRadius: radius.lg,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  composerButton: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    flex: 1,
    minHeight: 48,
    maxHeight: 112,
    paddingHorizontal: 5,
    paddingVertical: 12,
    color: colors.text,
    fontFamily,
    ...typography.input,
  },
  voiceInput: {
    minHeight: 44,
    flex: 1,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  voicePressed: {
    backgroundColor: colors.primarySoft,
  },
  voiceText: {
    color: colors.text,
    fontFamily,
    ...typography.label,
    fontWeight: '600',
  },
  recordingText: {
    color: colors.danger,
  },
  sendButton: {
    width: 42,
    height: 42,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  sendDisabled: {
    backgroundColor: colors.border,
  },
  sendPressed: {
    opacity: 0.82,
    transform: [{ scale: 0.96 }],
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
