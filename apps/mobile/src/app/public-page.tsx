import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppScreen } from '@/components/ui/app-screen';
import { NavHeader } from '@/components/ui/nav-header';
import { StatePanel } from '@/components/ui/state-panel';
import { PublicPageFrame } from '@/features/legal/public-page-frame';
import { isPublicPageKey, publicPages } from '@/features/legal/public-pages';

export default function PublicPageScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ page?: string | string[] }>();
  const rawPage = Array.isArray(params.page) ? params.page[0] : params.page;
  const page = isPublicPageKey(rawPage) ? publicPages[rawPage] : null;

  return (
    <AppScreen includeBottomInset>
      <NavHeader title={page?.title ?? '法律与支持'} />
      {page ? (
        <PublicPageFrame path={page.path} title={page.title} />
      ) : (
        <View style={styles.invalid}>
          <StatePanel
            actionLabel="返回"
            message="这个公开页面不存在或地址已经失效。"
            onAction={() => router.back()}
            title="页面不存在"
          />
        </View>
      )}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  invalid: {
    flex: 1,
    paddingHorizontal: 20,
    justifyContent: 'center',
  },
});
