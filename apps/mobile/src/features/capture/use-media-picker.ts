import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';

import type { LocalMedia } from './use-media-upload';

/**
 * 拍照与从相册选图。
 *
 * 权限在用户真正点「拍照」或「从相册选」时才申请，不在进页面时就弹窗：
 * 没有上下文的权限请求最容易被拒，而一旦拒了后面再要就难了。
 */
export function useImagePicker() {
  const [error, setError] = useState<string | null>(null);

  const pick = async (source: 'camera' | 'library'): Promise<LocalMedia[]> => {
    setError(null);

    const permission =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError(source === 'camera' ? '需要相机权限才能拍照。' : '需要相册权限才能选图。');
      return [];
    }

    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: ['images'],
      // 压一下再传：原图动辄十几 MB，而识别文字并不需要那个分辨率。
      quality: 0.7,
    };
    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync({ ...options, allowsMultipleSelection: true });

    if (result.canceled) return [];

    return result.assets.map((asset) => ({
      uri: asset.uri,
      kind: 'image' as const,
      // 服务端会回查真实类型，这里给不出时按 JPEG 声明即可。
      contentType: asset.mimeType ?? 'image/jpeg',
      byteSize: asset.fileSize,
    }));
  };

  return { pick, error, clearError: () => setError(null) };
}
