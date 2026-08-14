import { useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppScreen } from '@/components/ui/app-screen';
import { AppIcon } from '@/components/ui/icon';
import { NavHeader } from '@/components/ui/nav-header';
import { notes } from '@/mocks/data';
import { colors, fontFamily, radius } from '@/theme/tokens';

export default function NoteDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const note = useMemo(() => notes.find((item) => item.id === id) ?? notes[0], [id]);

  return (
    <AppScreen>
      <NavHeader
        right={
          <Pressable hitSlop={12}>
            <AppIcon name="ellipsis-horizontal" size={22} />
          </Pressable>
        }
      />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>{note.title}</Text>
        <View style={styles.meta}>
          <Text style={styles.time}>{note.time}</Text>
          <View style={[styles.tag, { backgroundColor: note.background }]}>
            <Text style={[styles.tagText, { color: note.color }]}>{note.tag}</Text>
          </View>
        </View>
        <Text style={styles.paragraph}>
          今天下午和产品、设计、研发一起过了首页改版的需求，整体方向大家比较认可。
        </Text>
        <Text style={styles.paragraph}>
          重点讨论了三个点：任务流交互优化、AI 悬浮球的入口位置、日历与清单的数据打通。
        </Text>
        <Text style={styles.paragraph}>
          结论：优先做任务流优化，减少点击层级，下周进入开发迭代。
        </Text>
      </ScrollView>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 20,
    paddingBottom: 30,
  },
  title: {
    color: colors.text,
    fontFamily,
    fontSize: 22,
    lineHeight: 31,
    fontWeight: '700',
  },
  meta: {
    marginTop: 11,
    marginBottom: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  time: {
    color: colors.textTertiary,
    fontFamily,
    fontSize: 13,
  },
  tag: {
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: radius.pill,
  },
  tagText: {
    fontFamily,
    fontSize: 11,
    fontWeight: '500',
  },
  paragraph: {
    marginBottom: 14,
    color: colors.text,
    fontFamily,
    fontSize: 15,
    lineHeight: 27,
  },
});
