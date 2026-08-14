import { useRouter } from 'expo-router';
import type { ComponentProps } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AiFab } from '@/components/ui/ai-fab';
import { AppScreen } from '@/components/ui/app-screen';
import { AppIcon } from '@/components/ui/icon';
import { PageHeader } from '@/components/ui/page-header';
import { colors, fontFamily, radius } from '@/theme/tokens';

type ListRowProps = {
  icon: ComponentProps<typeof AppIcon>['name'];
  iconColor: string;
  iconBackground: string;
  title: string;
  count: number;
  onPress?: () => void;
};

function ListRow({ icon, iconBackground, iconColor, title, count, onPress }: ListRowProps) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <View style={[styles.iconBox, { backgroundColor: iconBackground }]}>
        <AppIcon color={iconColor} name={icon} size={19} />
      </View>
      <Text style={styles.rowTitle}>{title}</Text>
      <Text style={styles.count}>{count}</Text>
      <AppIcon color="#C9CFCC" name="chevron-forward" size={18} />
    </Pressable>
  );
}

export default function ListsScreen() {
  const router = useRouter();

  return (
    <AppScreen>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <PageHeader
          action={
            <Pressable onPress={() => router.push('/tasks/new')} style={styles.addButton}>
              <AppIcon color={colors.primary} name="add" size={24} />
            </Pressable>
          }
          title="清单"
        />

        <Text style={styles.sectionTitle}>智能清单</Text>
        <View style={styles.sectionRows}>
          <ListRow
            count={3}
            icon="calendar-outline"
            iconBackground={colors.primarySoft}
            iconColor={colors.primary}
            onPress={() => router.push('/today')}
            title="今天"
          />
          <ListRow
            count={2}
            icon="calendar-clear-outline"
            iconBackground="#F1F3F5"
            iconColor={colors.textSecondary}
            title="明天"
          />
          <ListRow
            count={24}
            icon="checkmark"
            iconBackground={colors.primarySoft}
            iconColor={colors.primary}
            title="已完成"
          />
        </View>

        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>我的清单</Text>
          <Pressable hitSlop={8}>
            <Text style={styles.manageLink}>查看全部</Text>
          </Pressable>
        </View>
        <View style={styles.sectionRows}>
          <ListRow
            count={12}
            icon="folder-outline"
            iconBackground="#DBEAFE"
            iconColor={colors.blue}
            title="收集箱"
          />
          <ListRow
            count={8}
            icon="folder-outline"
            iconBackground="#DBEAFE"
            iconColor={colors.blue}
            title="工作"
          />
          <ListRow
            count={3}
            icon="folder-outline"
            iconBackground="#FEF3C7"
            iconColor={colors.warning}
            title="购物清单"
          />
        </View>

        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>标签</Text>
          <Pressable hitSlop={8}>
            <Text style={styles.manageLink}>管理</Text>
          </Pressable>
        </View>
        <View style={styles.tags}>
          <View style={[styles.tag, { backgroundColor: '#FEE2E2' }]}>
            <Text style={[styles.tagText, { color: '#EF4444' }]}>#重要</Text>
          </View>
          <View style={[styles.tag, { backgroundColor: '#FFEDD5' }]}>
            <Text style={[styles.tagText, { color: '#EA580C' }]}>#紧急</Text>
          </View>
          <View style={[styles.tag, { backgroundColor: '#EDE9FE' }]}>
            <Text style={[styles.tagText, { color: colors.purple }]}>#灵感</Text>
          </View>
          <View style={[styles.tag, { backgroundColor: '#FCE7F3' }]}>
            <Text style={[styles.tagText, { color: colors.pink }]}>#家庭</Text>
          </View>
        </View>
      </ScrollView>
      <AiFab count={1} />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 16,
    paddingBottom: 92,
  },
  addButton: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primarySoft,
  },
  sectionTitle: {
    color: colors.text,
    fontFamily,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
  },
  sectionRows: {
    marginTop: 8,
    marginBottom: 24,
  },
  row: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
  },
  pressed: {
    opacity: 0.65,
  },
  iconBox: {
    width: 34,
    height: 34,
    marginRight: 12,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTitle: {
    flex: 1,
    color: colors.text,
    fontFamily,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '500',
  },
  count: {
    marginRight: 12,
    color: colors.textTertiary,
    fontFamily,
    fontSize: 13,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  manageLink: {
    color: colors.primary,
    fontFamily,
    fontSize: 12,
    fontWeight: '500',
  },
  tags: {
    marginTop: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 9,
  },
  tag: {
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: radius.pill,
  },
  tagText: {
    fontFamily,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
  },
});
