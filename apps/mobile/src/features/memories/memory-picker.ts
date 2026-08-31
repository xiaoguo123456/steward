import type { ImagePickerAsset } from 'expo-image-picker';

import type { MemoryPhoto } from './memory-model';

export const MEMORY_PHOTO_LIMIT = 9;

export function imagePickerAssetsToMemoryPhotos(
  assets: readonly ImagePickerAsset[],
): MemoryPhoto[] {
  return assets.map((asset, index) => ({
    id: asset.assetId ?? `${asset.uri}-${index}`,
    source: { uri: asset.uri },
    description: `第 ${index + 1} 张照片`,
    local: {
      uri: asset.uri,
      contentType: imageContentType(asset),
      byteSize: asset.fileSize,
    },
  }));
}

function imageContentType(asset: ImagePickerAsset): string {
  if (asset.mimeType?.startsWith('image/')) return asset.mimeType.toLowerCase();
  const name = (asset.fileName ?? asset.uri).toLowerCase();
  if (name.endsWith('.png')) return 'image/png';
  if (name.endsWith('.webp')) return 'image/webp';
  if (name.endsWith('.heic') || name.endsWith('.heif')) return 'image/heic';
  return 'image/jpeg';
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
