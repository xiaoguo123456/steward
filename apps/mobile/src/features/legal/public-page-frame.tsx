import { createElement } from 'react';
import { StyleSheet, View } from 'react-native';

import { resolveApiBaseUrl } from '@/api/config';
import { colors } from '@/theme/tokens';

import { buildPublicPageUrl, type PublicPagePath } from './public-pages';

type PublicPageFrameProps = {
  path: PublicPagePath;
  title: string;
};

/** Web 预览同样在当前页面内阅读；原生安装包使用受控 WebView 实现。 */
export function PublicPageFrame({ path, title }: PublicPageFrameProps) {
  const uri = buildPublicPageUrl(resolveApiBaseUrl(), path);
  return (
    <View style={styles.frame}>
      {createElement('iframe', {
        referrerPolicy: 'no-referrer',
        sandbox: '',
        src: uri,
        style: { width: '100%', height: '100%', border: 0, background: colors.background },
        title,
      })}
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
});
