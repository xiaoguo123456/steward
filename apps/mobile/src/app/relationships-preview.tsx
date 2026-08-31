import { Redirect } from 'expo-router';
import { ScrollView, StyleSheet } from 'react-native';

import { AppScreen } from '@/components/ui/app-screen';
import { NavHeader } from '@/components/ui/nav-header';
import { RelationshipsContent } from '@/features/relationships/relationships-content';

/**
 * 亲友开发预览入口。
 *
 * 该路由只为未接入真实 Person 契约前的模拟器验收服务；正式构建立即返回启动页，
 * 不绕过登录，也不读取通讯录、账号数据或远程接口。
 */
export default function RelationshipsPreviewRoute() {
  if (!__DEV__) return <Redirect href="/" />;

  return (
    <AppScreen includeBottomInset>
      <NavHeader title="亲友" />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <RelationshipsContent />
      </ScrollView>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 16,
    paddingBottom: 32,
  },
});
