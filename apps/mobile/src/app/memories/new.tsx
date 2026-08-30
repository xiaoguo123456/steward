import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { AppButton } from '@/components/ui/app-button';
import { AppScreen } from '@/components/ui/app-screen';
import { AppIcon } from '@/components/ui/icon';
import { NavHeader } from '@/components/ui/nav-header';
import { useMemoriesPrototype } from '@/features/memories/memories-context';
import {
  buildPrototypeWritingCandidate,
  isMemoryDateKey,
  todayMemoryDateKey,
  type MemoryPhoto,
  type MemoryWritingCandidate,
} from '@/features/memories/memory-model';
import {
  imagePickerAssetsToMemoryPhotos,
  MEMORY_PHOTO_LIMIT,
  mergeMemoryPhotos,
  moveMemoryPhoto,
} from '@/features/memories/memory-picker';
import { colors, fontFamily, radius } from '@/theme/tokens';

export default function MemoryEditorScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    id?: string | string[];
    date?: string | string[];
    pick?: string | string[];
  }>();
  const rawId = Array.isArray(params.id) ? params.id[0] : params.id;
  const rawDate = Array.isArray(params.date) ? params.date[0] : params.date;
  const rawPick = Array.isArray(params.pick) ? params.pick[0] : params.pick;
  const { moments, addMoment, updateMoment } = useMemoriesPrototype();
  const existing = moments.find((moment) => moment.id === rawId);
  const [photos, setPhotos] = useState<MemoryPhoto[]>(existing?.photos ?? []);
  const [date, setDate] = useState(
    existing?.date ?? (isMemoryDateKey(rawDate ?? '') ? rawDate! : todayMemoryDateKey()),
  );
  const [title, setTitle] = useState(existing?.title ?? '');
  const [story, setStory] = useState(existing?.story ?? '');
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [candidate, setCandidate] = useState<MemoryWritingCandidate | null>(null);
  const [generating, setGenerating] = useState(false);
  const [pendingResultChecked, setPendingResultChecked] = useState(false);
  const initialPickerOpened = useRef(false);
  const dateValid = isMemoryDateKey(date);
  const saveDisabled = photos.length === 0 || !dateValid;

  useEffect(() => {
    if (existing || photos.length > 0) return;
    let mounted = true;
    void ImagePicker.getPendingResultAsync()
      .then((pending) => {
        if (!mounted || !pending || 'code' in pending || pending.canceled) return;
        setPhotos((current) => mergeMemoryPhotos(
          current,
          imagePickerAssetsToMemoryPhotos(pending.assets),
        ));
      })
      .finally(() => {
        if (mounted) setPendingResultChecked(true);
      });
    return () => { mounted = false; };
  }, [existing, photos.length]);

  const pickImages = useCallback(async () => {
    const remaining = MEMORY_PHOTO_LIMIT - photos.length;
    if (remaining <= 0) return;
    setPickerError(null);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: remaining,
        quality: 0.9,
      });
      if (result.canceled) return;
      setPhotos((current) => mergeMemoryPhotos(
        current,
        imagePickerAssetsToMemoryPhotos(result.assets),
      ));
    } catch {
      setPickerError('没有打开照片选择器。请稍后重试，已填写的内容仍会保留。');
    }
  }, [photos.length]);

  useEffect(() => {
    if (
      existing
      || !pendingResultChecked
      || photos.length > 0
      || rawPick !== '1'
      || initialPickerOpened.current
    ) return;
    initialPickerOpened.current = true;
    void pickImages();
  }, [existing, pendingResultChecked, photos.length, pickImages, rawPick]);

  const generateCandidate = async () => {
    if (photos.length === 0 || generating) return;
    setGenerating(true);
    setCandidate(null);
    await new Promise((resolve) => setTimeout(resolve, 650));
    setCandidate(buildPrototypeWritingCandidate({
      date,
      photoCount: photos.length,
      title,
      story,
    }));
    setGenerating(false);
  };

  const save = () => {
    if (saveDisabled) return;
    const input = { date, title: title.trim(), story: story.trim(), photos };
    if (existing) {
      updateMoment(existing.id, input);
      router.replace({ pathname: '/memories/[id]', params: { id: existing.id } });
      return;
    }
    const id = addMoment(input);
    router.replace({ pathname: '/memories/[id]', params: { id } });
  };

  return (
    <AppScreen includeBottomInset>
      <NavHeader title={existing ? '编辑时光' : '添加时光'} />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.privacyNote}>
          <AppIcon color={colors.primaryStrong} name="shield-checkmark-outline" size={17} />
          <Text style={styles.privacyText}>当前是本地交互原型，不会上传图片或写入云端。</Text>
        </View>

        <View style={styles.sectionHeading}>
          <View>
            <Text accessibilityRole="header" style={styles.sectionTitle}>照片</Text>
            <Text style={styles.sectionMeta}>至少 1 张，最多 {MEMORY_PHOTO_LIMIT} 张</Text>
          </View>
          {photos.length > 0 ? <Text style={styles.photoCount}>{photos.length}/{MEMORY_PHOTO_LIMIT}</Text> : null}
        </View>

        {photos.length === 0 ? (
          <Pressable
            accessibilityLabel="从相册选择照片"
            accessibilityRole="button"
            onPress={() => void pickImages()}
            style={({ pressed }) => [styles.photoEmpty, pressed && styles.photoEmptyPressed]}
          >
            <View style={styles.photoEmptyIcon}>
              <AppIcon color={colors.primaryStrong} name="images-outline" size={25} />
            </View>
            <Text style={styles.photoEmptyTitle}>先选择照片</Text>
            <Text style={styles.photoEmptyMessage}>有照片才能创建时光，文字可以稍后再写。</Text>
          </Pressable>
        ) : (
          <ScrollView
            contentContainerStyle={styles.photoRail}
            horizontal
            showsHorizontalScrollIndicator={false}
          >
            {photos.map((photo, index) => (
              <View key={photo.id} style={styles.photoTile}>
                <View style={styles.photoFrame}>
                  <Image contentFit="cover" source={photo.source} style={StyleSheet.absoluteFill} />
                  <View style={styles.orderBadge}>
                    <Text style={styles.orderText}>{index + 1}</Text>
                  </View>
                  <Pressable
                    accessibilityLabel={`移除第 ${index + 1} 张照片`}
                    accessibilityRole="button"
                    hitSlop={6}
                    onPress={() => setPhotos((current) => current.filter((_, currentIndex) => currentIndex !== index))}
                    style={({ pressed }) => [styles.removePhoto, pressed && styles.removePhotoPressed]}
                  >
                    <AppIcon color={colors.background} name="close" size={15} />
                  </Pressable>
                </View>
                <View style={styles.orderActions}>
                  <Pressable
                    accessibilityLabel={`第 ${index + 1} 张照片向前移动`}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: index === 0 }}
                    disabled={index === 0}
                    onPress={() => setPhotos((current) => moveMemoryPhoto(current, index, -1))}
                    style={({ pressed }) => [styles.orderButton, index === 0 && styles.orderButtonDisabled, pressed && styles.orderButtonPressed]}
                  ><AppIcon color={index === 0 ? colors.textTertiary : colors.textSecondary} name="arrow-back" size={16} /></Pressable>
                  <Pressable
                    accessibilityLabel={`第 ${index + 1} 张照片向后移动`}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: index === photos.length - 1 }}
                    disabled={index === photos.length - 1}
                    onPress={() => setPhotos((current) => moveMemoryPhoto(current, index, 1))}
                    style={({ pressed }) => [styles.orderButton, index === photos.length - 1 && styles.orderButtonDisabled, pressed && styles.orderButtonPressed]}
                  ><AppIcon color={index === photos.length - 1 ? colors.textTertiary : colors.textSecondary} name="arrow-forward" size={16} /></Pressable>
                </View>
              </View>
            ))}
            {photos.length < MEMORY_PHOTO_LIMIT ? (
              <Pressable
                accessibilityLabel="继续选择照片"
                accessibilityRole="button"
                onPress={() => void pickImages()}
                style={({ pressed }) => [styles.addPhoto, pressed && styles.photoEmptyPressed]}
              >
                <AppIcon color={colors.primaryStrong} name="add" size={23} />
                <Text style={styles.addPhotoText}>继续添加</Text>
              </Pressable>
            ) : null}
          </ScrollView>
        )}
        {pickerError ? <Text accessibilityRole="alert" style={styles.errorText}>{pickerError}</Text> : null}

        <View style={styles.fields}>
          <Field label="日期" required>
            <TextInput
              accessibilityLabel="时光日期，格式为年横线月横线日"
              autoCapitalize="none"
              inputMode="numeric"
              maxLength={10}
              onChangeText={setDate}
              placeholder="2026-08-28"
              placeholderTextColor={colors.textSecondary}
              style={[styles.input, !dateValid && styles.inputError]}
              value={date}
            />
            {!dateValid ? <Text style={styles.fieldError}>请输入有效日期，例如 2026-08-28。</Text> : null}
          </Field>
          <Field label="标题（选填）">
            <TextInput
              maxLength={32}
              onChangeText={setTitle}
              placeholder="给这段时光起个名字"
              placeholderTextColor={colors.textSecondary}
              style={styles.input}
              value={title}
            />
          </Field>
          <Field label="故事（选填）">
            <TextInput
              maxLength={300}
              multiline
              onChangeText={setStory}
              placeholder="那天发生了什么？"
              placeholderTextColor={colors.textSecondary}
              style={[styles.input, styles.storyInput]}
              textAlignVertical="top"
              value={story}
            />
          </Field>
        </View>

        <View style={styles.aiSection}>
          <View style={styles.aiHeading}>
            <View style={styles.aiIcon}>
              <AppIcon color={colors.primaryStrong} name="sparkles-outline" size={18} />
            </View>
            <View style={styles.aiHeadingCopy}>
              <Text accessibilityRole="header" style={styles.aiTitle}>整理成一段回忆</Text>
              <Text style={styles.aiMeta}>AI Candidate 交互演示 · 不发送图片</Text>
            </View>
          </View>
          {candidate ? (
            <View style={styles.candidate}>
              <Text style={styles.candidateSource}>来源：{candidate.sourceSummary}</Text>
              <Text style={styles.candidateTitle}>{candidate.title}</Text>
              <Text style={styles.candidateStory}>{candidate.story}</Text>
              <View style={styles.candidateActions}>
                <AppButton
                  compact
                  label="采用这段文案"
                  onPress={() => {
                    setTitle(candidate.title);
                    setStory(candidate.story);
                    setCandidate(null);
                  }}
                  style={styles.candidateAction}
                />
                <AppButton
                  compact
                  label="忽略建议"
                  onPress={() => setCandidate(null)}
                  style={styles.candidateAction}
                  variant="text"
                />
              </View>
            </View>
          ) : (
            <AppButton
              disabled={photos.length === 0 || generating || !dateValid}
              icon="sparkles-outline"
              label={generating ? '正在整理…' : '帮我整理这段时光'}
              onPress={() => void generateCandidate()}
              variant="secondary"
            />
          )}
          {generating ? <ActivityIndicator color={colors.primary} style={styles.aiLoading} /> : null}
        </View>

        <AppButton
          disabled={saveDisabled}
          label={existing ? '保存修改' : '保存这段时光'}
          onPress={save}
          style={styles.saveButton}
        />
        {photos.length === 0 ? <Text style={styles.saveHint}>选择至少 1 张照片后才能保存。</Text> : null}
      </ScrollView>
    </AppScreen>
  );
}

function Field({
  label,
  required = false,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}{required ? ' *' : ''}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 16,
    paddingBottom: 32,
  },
  privacyNote: {
    minHeight: 42,
    marginTop: 4,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: radius.sm,
    backgroundColor: colors.primarySoft,
  },
  privacyText: {
    flex: 1,
    color: colors.primaryStrong,
    fontFamily,
    fontSize: 12,
    lineHeight: 18,
  },
  sectionHeading: {
    marginTop: 24,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    color: colors.text,
    fontFamily,
    fontSize: 18,
    lineHeight: 26,
    fontWeight: '600',
  },
  sectionMeta: {
    marginTop: 2,
    color: colors.textSecondary,
    fontFamily,
    fontSize: 12,
    lineHeight: 18,
  },
  photoCount: {
    color: colors.primaryStrong,
    fontFamily,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
  },
  photoEmpty: {
    minHeight: 210,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceSubtle,
  },
  photoEmptyPressed: {
    opacity: 0.64,
  },
  photoEmptyIcon: {
    width: 50,
    height: 50,
    marginBottom: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
  },
  photoEmptyTitle: {
    color: colors.text,
    fontFamily,
    fontSize: 16,
    lineHeight: 23,
    fontWeight: '600',
  },
  photoEmptyMessage: {
    maxWidth: 240,
    marginTop: 5,
    color: colors.textSecondary,
    fontFamily,
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
  },
  photoRail: {
    paddingRight: 8,
    gap: 10,
  },
  photoTile: {
    width: 116,
  },
  photoFrame: {
    width: 116,
    height: 116,
    overflow: 'hidden',
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  orderBadge: {
    position: 'absolute',
    top: 7,
    left: 7,
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: 'rgba(16, 24, 21, 0.66)',
  },
  orderText: {
    color: colors.background,
    fontFamily,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '700',
  },
  removePhoto: {
    position: 'absolute',
    top: 5,
    right: 5,
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: 'rgba(16, 24, 21, 0.66)',
  },
  removePhotoPressed: {
    backgroundColor: colors.danger,
  },
  orderActions: {
    marginTop: 5,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 2,
  },
  orderButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
  orderButtonDisabled: {
    opacity: 0.45,
  },
  orderButtonPressed: {
    backgroundColor: colors.surface,
  },
  addPhoto: {
    width: 116,
    height: 116,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
  },
  addPhotoText: {
    color: colors.primaryStrong,
    fontFamily,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600',
  },
  errorText: {
    marginTop: 10,
    color: colors.danger,
    fontFamily,
    fontSize: 13,
    lineHeight: 20,
  },
  fields: {
    marginTop: 26,
    gap: 18,
  },
  field: {
    gap: 7,
  },
  fieldLabel: {
    color: colors.text,
    fontFamily,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
  input: {
    minHeight: 52,
    paddingHorizontal: 14,
    color: colors.text,
    fontFamily,
    fontSize: 16,
    lineHeight: 24,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSubtle,
  },
  inputError: {
    borderWidth: 1,
    borderColor: colors.danger,
  },
  fieldError: {
    color: colors.danger,
    fontFamily,
    fontSize: 12,
    lineHeight: 18,
  },
  storyInput: {
    minHeight: 112,
    paddingTop: 13,
    paddingBottom: 13,
  },
  aiSection: {
    marginTop: 28,
    padding: 14,
    borderRadius: radius.lg,
    backgroundColor: colors.primarySoft,
  },
  aiHeading: {
    marginBottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  aiIcon: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    backgroundColor: colors.background,
  },
  aiHeadingCopy: {
    flex: 1,
  },
  aiTitle: {
    color: colors.text,
    fontFamily,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
  },
  aiMeta: {
    marginTop: 1,
    color: colors.primaryStrong,
    fontFamily,
    fontSize: 11,
    lineHeight: 16,
  },
  aiLoading: {
    marginTop: 12,
  },
  candidate: {
    paddingTop: 2,
  },
  candidateSource: {
    color: colors.primaryStrong,
    fontFamily,
    fontSize: 11,
    lineHeight: 16,
  },
  candidateTitle: {
    marginTop: 8,
    color: colors.text,
    fontFamily,
    fontSize: 16,
    lineHeight: 23,
    fontWeight: '600',
  },
  candidateStory: {
    marginTop: 5,
    color: colors.textSecondary,
    fontFamily,
    fontSize: 14,
    lineHeight: 21,
  },
  candidateActions: {
    marginTop: 14,
    flexDirection: 'row',
    gap: 6,
  },
  candidateAction: {
    flex: 1,
  },
  saveButton: {
    marginTop: 28,
  },
  saveHint: {
    marginTop: 8,
    color: colors.textSecondary,
    fontFamily,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
});
