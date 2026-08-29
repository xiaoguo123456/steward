import * as WebBrowser from 'expo-web-browser';

import { resolveApiBaseUrl } from '@/api/config';
import { buildPublicPageUrl, type PublicPagePath } from './public-pages';

/** 使用系统安全浏览器打开公开 H5；不在 App 内嵌任意 WebView。 */
export async function openPublicPage(path: PublicPagePath): Promise<void> {
  await WebBrowser.openBrowserAsync(buildPublicPageUrl(resolveApiBaseUrl(), path));
}
