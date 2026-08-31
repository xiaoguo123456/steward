import {
  createMemoryMoment,
  errorMessage,
  getGetMemoryMomentQueryKey,
  getListMemoryMomentsQueryKey,
  newIdempotencyKey,
  type MemoryMomentPhotoInput,
} from '@steward/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
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
import { useMediaUpload, type UploadedMedia } from '@/features/capture/use-media-upload';
import type { MemoryPhoto } from '@/features/memories/memory-model';
import {
  imagePickerAssetsToMemoryPhotos,
  MEMORY_PHOTO_LIMIT,
  mergeMemoryPhotos,
  moveMemoryPhoto,
} from '@/features/memories/memory-picker';
import { colors, fontFamily, radius } from '@/theme/tokens';

type UploadedSelection = {
  signature: string;
  media: UploadedMedia[];
};

type SubmissionKey = {
  signature: string;
  key: string;
};

export default function MemoryEditorScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{
    pick?: string | string[];
  }>();
  const rawPick = Array.isArray(params.pick) ? params.pick[0] : params.pick;
  const [photos, setPhotos] = useState<MemoryPhoto[]>([]);
  const [description, setDescription] = useState('');
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [pendingResultChecked, setPendingResultChecked] = useState(false);
  const initialPickerOpened = useRef(false);
  const uploadedRef = useRef<UploadedSelection | null>(null);
  const submissionKeyRef = useRef<SubmissionKey | null>(null);
  const { upload, uploading } = useMediaUpload();
  const publishDisabled = photos.length === 0 || publishing || uploading;

  useEffect(() => {
    if (photos.length > 0) return;
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
  }, [photos.length]);

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
      !pendingResultChecked
      || photos.length > 0
      || rawPick !== '1'
      || initialPickerOpened.current
    ) return;
    initialPickerOpened.current = true;
    void pickImages();
  }, [pendingResultChecked, photos.length, pickImages, rawPick]);

  const publish = async () => {
    if (publishDisabled) return;
    const localPhotos = photos.map((photo) => photo.local).filter((photo) => photo !== undefined);
    if (localPhotos.length !== photos.length) {
      setFailure('有照片已经失效，请重新选择后再发布。');
      return;
    }

    setPublishing(true);
    setFailure(null);
    try {
      const photoSignature = JSON.stringify(localPhotos.map((photo) => [
        photo.uri, photo.contentType, photo.byteSize ?? null,
      ]));
      let uploaded = uploadedRef.current;
      if (!uploaded || uploaded.signature !== photoSignature) {
        uploaded = {
          signature: photoSignature,
          media: await upload(localPhotos.map((photo) => ({ ...photo, kind: 'image' }))),
        };
        uploadedRef.current = uploaded;
      }

      const photoInputs: MemoryMomentPhotoInput[] = uploaded.media.map((media, index) => ({
        media_id: media.mediaId,
        description: photos[index].description,
      }));
      const body = {
        description: description.trim() || undefined,
        photos: photoInputs,
      };
      const submissionSignature = JSON.stringify(body);
      let submission = submissionKeyRef.current;
      if (!submission || submission.signature !== submissionSignature) {
        submission = { signature: submissionSignature, key: newIdempotencyKey() };
        submissionKeyRef.current = submission;
      }
      const response = await createMemoryMoment(body, {
        headers: { 'Idempotency-Key': submission.key },
      });
      queryClient.setQueryData(getGetMemoryMomentQueryKey(response.data.id), response);
      await queryClient.invalidateQueries({ queryKey: getListMemoryMomentsQueryKey() });
      router.replace({ pathname: '/memories/[id]', params: { id: response.data.id } });
    } catch (error) {
      setFailure(errorMessage(error, '发布没有完成，请检查网络后重试。'));
    } finally {
      setPublishing(false);
    }
  };

  return (
    <AppScreen includeBottomInset>
      <NavHeader title="添加时光" />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.sectionHeading}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>照片</Text>
          {photos.length > 0 ? (
            <Text style={styles.photoCount}>{photos.length}/{MEMORY_PHOTO_LIMIT}</Text>
          ) : null}
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
                    style={({ pressed }) => [
                      styles.orderButton,
                      index === 0 && styles.orderButtonDisabled,
                      pressed && styles.orderButtonPressed,
                    ]}
                  >
                    <AppIcon
                      color={index === 0 ? colors.textTertiary : colors.textSecondary}
                      name="arrow-back"
                      size={16}
                    />
                  </Pressable>
                  <Pressable
                    accessibilityLabel={`第 ${index + 1} 张照片向后移动`}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: index === photos.length - 1 }}
                    disabled={index === photos.length - 1}
                    onPress={() => setPhotos((current) => moveMemoryPhoto(current, index, 1))}
                    style={({ pressed }) => [
                      styles.orderButton,
                      index === photos.length - 1 && styles.orderButtonDisabled,
                      pressed && styles.orderButtonPressed,
                    ]}
                  >
                    <AppIcon
                      color={index === photos.length - 1 ? colors.textTertiary : colors.textSecondary}
                      name="arrow-forward"
                      size={16}
                    />
                  </Pressable>
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
          <Field label="描述">
            <TextInput
              accessibilityLabel="时光描述"
              maxLength={500}
              multiline
              onChangeText={setDescription}
              placeholder="这一刻…"
              placeholderTextColor={colors.textSecondary}
              style={[styles.input, styles.descriptionInput]}
              textAlignVertical="top"
              value={description}
            />
          </Field>
        </View>

        {failure ? <Text accessibilityRole="alert" style={styles.publishError}>{failure}</Text> : null}
        <AppButton
          disabled={publishDisabled}
          label={uploading ? '正在上传照片…' : publishing ? '正在发布…' : '发布这段时光'}
          onPress={() => void publish()}
          style={styles.publishButton}
        />
      </ScrollView>
    </AppScreen>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 16,
    paddingBottom: 32,
  },
  sectionHeading: {
    marginTop: 16,
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
  descriptionInput: {
    minHeight: 112,
    paddingTop: 13,
    paddingBottom: 13,
  },
  publishError: {
    marginTop: 24,
    color: colors.danger,
    fontFamily,
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
  },
  publishButton: {
    marginTop: 28,
  },
});
