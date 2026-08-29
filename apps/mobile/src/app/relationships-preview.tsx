import { Redirect } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppScreen } from '@/components/ui/app-screen';
import { PageHeader } from '@/components/ui/page-header';
import { StatePanel } from '@/components/ui/state-panel';
import type { HomeTopTabId } from '@/features/home/home-top-navigation';
import { HomeFeaturePreview, HomeTopTabs } from '@/features/home/home-top-tabs';
import { RelationshipsContent } from '@/features/relationships/relationships-content';
import { fontFamily } from '@/theme/tokens';

/**
 * 亲友开发预览入口。
 *
 * 该路由只为未接入真实 Person 契约前的模拟器验收服务；正式构建立即返回启动页，
 * 不绕过登录，也不读取通讯录、账号数据或远程接口。
 */
export default function RelationshipsPreviewRoute() {
  const [activeTab, setActiveTab] = useState<HomeTopTabId>('relationships');

  if (!__DEV__) return <Redirect href="/" />;

  return (
    <AppScreen includeBottomInset>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        stickyHeaderIndices={[1]}
      >
        <PageHeader
          action={
            <View accessibilityLabel="本地界面预览" style={styles.previewBadge}>
              <Text style={styles.previewBadgeText}>预览</Text>
            </View>
          }
          subtitle="8月28日 · 星期五"
          title="首页"
        />

        <HomeTopTabs onChange={setActiveTab} value={activeTab} />

        {activeTab === 'relationships' ? (
          <RelationshipsContent />
        ) : activeTab === 'today' ? (
          <View style={styles.placeholder}>
            <StatePanel
              icon="shield-checkmark-outline"
              message="开发预览入口不加载账号数据；返回正式首页后可查看今天的真实内容。"
              title="今天保持安全隔离"
            />
          </View>
        ) : (
          <HomeFeaturePreview tab={activeTab} />
        )}
      </ScrollView>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 16,
    paddingBottom: 32,
  },
  previewBadge: {
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EAF4FF',
  },
  previewBadgeText: {
    color: '#236DB8',
    fontFamily,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  placeholder: {
    paddingTop: 24,
  },
});
