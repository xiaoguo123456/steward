import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';

import { resolveApiBaseUrl } from '@/api/config';
import { StatePanel } from '@/components/ui/state-panel';
import { colors, fontFamily, typography } from '@/theme/tokens';

import {
  appRouteForPublicPageUrl,
  buildPublicPageUrl,
  isAllowedPublicPageUrl,
  type PublicPagePath,
} from './public-pages';

type PublicPageFrameProps = {
  path: PublicPagePath;
  title: string;
};

export function PublicPageFrame({ path, title }: PublicPageFrameProps) {
  const router = useRouter();
  const baseUrl = resolveApiBaseUrl();
  const uri = useMemo(() => buildPublicPageUrl(baseUrl, path), [baseUrl, path]);
  const origin = useMemo(() => new URL(uri).origin, [uri]);
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<string | null>(null);

  const shouldStart = useCallback((request: { url: string }) => {
    if (isAllowedPublicPageUrl(request.url, baseUrl)) return true;

    const appRoute = appRouteForPublicPageUrl(request.url, baseUrl);
    if (appRoute) {
      router.push(appRoute);
      return false;
    }

    try {
      const target = new URL(request.url);
      if (target.protocol === 'https:' || target.protocol === 'mailto:' || target.protocol === 'tel:') {
        void Linking.openURL(request.url);
      }
    } catch {
      // 非法或未知协议直接拦截，不交给系统处理。
    }
    return false;
  }, [baseUrl, router]);

  const retry = () => {
    setFailure(null);
    setLoading(true);
    setAttempt((current) => current + 1);
  };

  return (
    <View style={styles.frame}>
      <WebView
        allowFileAccess={false}
        allowUniversalAccessFromFileURLs={false}
        cacheEnabled
        domStorageEnabled={false}
        incognito
        javaScriptCanOpenWindowsAutomatically={false}
        javaScriptEnabled={false}
        key={`${path}-${attempt}`}
        mixedContentMode="never"
        onError={() => {
          setLoading(false);
          setFailure('请检查网络后重试。协议页面不会影响你已填写的登录信息。');
        }}
        onHttpError={(event) => {
          if (event.nativeEvent.statusCode < 400) return;
          setLoading(false);
          setFailure(`页面返回了 ${event.nativeEvent.statusCode}，请稍后重试。`);
        }}
        onLoadEnd={() => setLoading(false)}
        onLoadStart={() => {
          setFailure(null);
          setLoading(true);
        }}
        onShouldStartLoadWithRequest={shouldStart}
        originWhitelist={[origin]}
        setSupportMultipleWindows={false}
        sharedCookiesEnabled={false}
        source={{ uri }}
        style={styles.webView}
        thirdPartyCookiesEnabled={false}
      />

      {loading && !failure ? (
        <View accessibilityLiveRegion="polite" pointerEvents="none" style={styles.loading}>
          <ActivityIndicator color={colors.primaryStrong} />
          <Text style={styles.loadingText}>正在打开{title}…</Text>
        </View>
      ) : null}

      {failure ? (
        <View style={styles.failure}>
          <StatePanel
            actionLabel="重新加载"
            icon="cloud-offline-outline"
            message={failure}
            onAction={retry}
            title="页面暂时打不开"
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    flex: 1,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  webView: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loading: {
    position: 'absolute',
    inset: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: colors.background,
  },
  loadingText: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  failure: {
    position: 'absolute',
    inset: 0,
    paddingHorizontal: 20,
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
});
