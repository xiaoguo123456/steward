import type { ImagePickerAsset } from 'expo-image-picker';

import type { MemoryPhoto } from './memory-model';

export const MEMORY_PHOTO_LIMIT = 9;

export function imagePickerAssetsToMemoryPhotos(
  assets: readonly ImagePickerAsset[],
): MemoryPhoto[] {
  return assets.map((asset, index) => ({
    id: asset.assetId ?? `${asset.uri}-${index}`,
    source: { uri: asset.uri },
    description: asset.fileName ? `已选择的照片 ${asset.fileName}` : `已选择的照片 ${index + 1}`,
  }));
}

export function mergeMemoryPhotos(
  current: readonly MemoryPhoto[],
  incoming: readonly MemoryPhoto[],
): MemoryPhoto[] {
  const result = [...current];
  const known = new Set(current.map((photo) => photo.id));
  for (const photo of incoming) {
    if (known.has(photo.id) || result.length >= MEMORY_PHOTO_LIMIT) continue;
    known.add(photo.id);
    result.push(photo);
  }
  return result;
}

export function moveMemoryPhoto(
  photos: readonly MemoryPhoto[],
  index: number,
  offset: -1 | 1,
): MemoryPhoto[] {
  const target = index + offset;
  if (index < 0 || index >= photos.length || target < 0 || target >= photos.length) {
    return [...photos];
  }
  const moved = [...photos];
  [moved[index], moved[target]] = [moved[target], moved[index]];
  return moved;
}
