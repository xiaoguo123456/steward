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
  useWindowDimensions,
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
} from '@/features/memories/memory-picker';
import { colors, fontFamily, radius, spacing } from '@/theme/tokens';

type UploadedSelection = {
  signature: string;
  media: UploadedMedia[];
};

type SubmissionKey = {
  signature: string;
  key: string;
};

const PHOTO_GRID_COLUMNS = 3;
const PHOTO_TILE_MAX_SIZE = 132;

export default function MemoryEditorScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { width } = useWindowDimensions();
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
  const photoTileSize = Math.min(
    PHOTO_TILE_MAX_SIZE,
    Math.floor(
      (width - spacing.lg * 2 - spacing.sm * (PHOTO_GRID_COLUMNS - 1))
      / PHOTO_GRID_COLUMNS,
    ),
  );

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
        <Text accessibilityRole="header" style={styles.sectionTitle}>照片</Text>
        <View style={styles.photoGrid}>
          {photos.map((photo, index) => (
            <View
              key={photo.id}
              style={[styles.photoFrame, { width: photoTileSize, height: photoTileSize }]}
            >
              <Image contentFit="cover" source={photo.source} style={StyleSheet.absoluteFill} />
              <Pressable
                accessibilityLabel={`移除第 ${index + 1} 张照片`}
                accessibilityRole="button"
                onPress={() => setPhotos((current) => current.filter((_, currentIndex) => currentIndex !== index))}
                style={styles.removePhotoHitbox}
              >
                {({ pressed }) => (
                  <View style={[styles.removePhotoIcon, pressed && styles.removePhotoPressed]}>
                    <AppIcon color={colors.background} name="close" size={14} />
                  </View>
                )}
              </Pressable>
            </View>
          ))}
          {photos.length < MEMORY_PHOTO_LIMIT ? (
            <Pressable
              accessibilityLabel={photos.length === 0 ? '从相册选择照片' : '继续选择照片'}
              accessibilityRole="button"
              onPress={() => void pickImages()}
              style={({ pressed }) => [
                styles.addPhoto,
                { width: photoTileSize, height: photoTileSize },
                pressed && styles.addPhotoPressed,
              ]}
            >
              <View pointerEvents="none" style={styles.addPhotoIcon}>
                <AppIcon color={colors.textSecondary} name="add" size={27} />
              </View>
            </Pressable>
          ) : null}
        </View>
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
  sectionTitle: {
    marginTop: 16,
    marginBottom: 12,
    color: colors.text,
    fontFamily,
    fontSize: 18,
    lineHeight: 26,
    fontWeight: '600',
  },
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  photoFrame: {
    overflow: 'hidden',
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  removePhotoHitbox: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 48,
    height: 48,
    alignItems: 'flex-end',
    paddingTop: spacing.xs,
    paddingRight: spacing.xs,
  },
  removePhotoIcon: {
    width: 26,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: 'rgba(16, 24, 21, 0.68)',
  },
  removePhotoPressed: {
    backgroundColor: colors.danger,
  },
  addPhoto: {
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceSubtle,
  },
  addPhotoIcon: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addPhotoPressed: {
    opacity: 0.62,
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
