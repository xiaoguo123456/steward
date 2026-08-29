import {
  completeMediaUpload,
  createUploadGrants,
  type MediaKind,
  type UploadGrant,
} from '@steward/api-client';
import { File, UploadType } from 'expo-file-system';
import { useState } from 'react';
import { Platform } from 'react-native';

/**
 * 媒体直传。
 *
 * 链路是「申请授权 → 直传对象存储 → 通知服务端」三步：字节不经过 API 进程，
 * 否则一张几 MB 的图会把连接和内存占住。
 *
 * 上传地址是短期签名 URL，**不能写进日志、不能分享、不能缓存**。
 * 服务端在第三步会回查真实大小与类型，不采信客户端声明的值。
 */

/** 待上传的本地文件。 */
export type LocalMedia = {
  /** 本地临时路径。expo-image-picker 与 expo-audio 都给这个。 */
  uri: string;
  kind: MediaKind;
  contentType: string;
  byteSize?: number;
};

/** 上传成功后拿到的引用，用来提交 Capture。 */
export type UploadedMedia = {
  mediaId: string;
  kind: MediaKind;
};

export function useMediaUpload() {
  const [uploading, setUploading] = useState(false);

  /**
   * 批量上传，全部成功才返回。
   *
   * 任何一项失败就整体抛错：Capture 引用一个上传了一半的资产没有意义，
   * 让用户重试整批比让他猜哪张图没传上去清楚。
   */
  const upload = async (items: LocalMedia[]): Promise<UploadedMedia[]> => {
    if (items.length === 0) return [];
    setUploading(true);
    try {
      const grants = await createUploadGrants({
        items: items.map((item) => ({
          kind: item.kind,
          content_type: item.contentType,
          byte_size: item.byteSize ?? null,
        })),
      });

      const uploaded: UploadedMedia[] = [];
      for (const [index, grant] of grants.data.entries()) {
        const item = items[index];
        const byteSize = await putBytes(grant, item);
        // 通知服务端去回查真实元数据。只有回查过的资产才能被 Capture 引用。
        await completeMediaUpload(grant.media_id, { byte_size: byteSize });
        uploaded.push({ mediaId: grant.media_id, kind: item.kind });
      }
      return uploaded;
    } finally {
      setUploading(false);
    }
  };

  return { upload, uploading };
}

/**
 * 把本地文件的字节发到签名地址。
 *
 * 原生平台走 expo-file-system 的 File.upload：它从磁盘流式发送，
 * 而 fetch + Blob 会把整个文件读进内存——几张原图就能把低端机撑爆。
 * Web 上没有这个 API，退回 fetch。
 *
 * headers 必须原样带上：其中 Content-Type 参与了签名计算，改一个字符
 * 对象存储就会拒收。
 *
 * 返回实际发送的字节数，交给服务端比对——但最终以服务端回查为准。
 */
export async function putBytes(grant: UploadGrant, item: LocalMedia): Promise<number> {
  const headers = grant.headers ?? {};

  if (Platform.OS === 'web') {
    const blob = await (await fetch(item.uri)).blob();
    assertWithinLimit(blob.size, grant);
    const result = await fetch(grant.upload_url, {
      method: grant.method,
      headers,
      body: blob,
    });
    if (!result.ok) {
      throw uploadFailed(result.status);
    }
    return blob.size;
  }

  const file = new File(item.uri);
  assertWithinLimit(file.size ?? item.byteSize ?? 0, grant);
  const result = await file.upload(grant.upload_url, {
    httpMethod: grant.method,
    uploadType: UploadType.BINARY_CONTENT,
    headers,
  });
  if (result.status < 200 || result.status >= 300) {
    throw uploadFailed(result.status);
  }
  return file.size ?? item.byteSize ?? 0;
}

function assertWithinLimit(size: number, grant: UploadGrant) {
  if (grant.max_bytes && size > grant.max_bytes) {
    throw new Error(`文件超过 ${Math.round(grant.max_bytes / 1024 / 1024)} MB 上限`);
  }
}

/** 不把签名地址写进错误信息：它会流到日志和错误上报里。 */
function uploadFailed(status: number) {
  return new Error(`上传失败（HTTP ${status}）`);
}
