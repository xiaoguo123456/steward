import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { AiFab } from '@/components/ui/ai-fab';
import { AppScreen } from '@/components/ui/app-screen';
import { AppIcon } from '@/components/ui/icon';
import { notes } from '@/mocks/data';
import { colors, fontFamily, radius } from '@/theme/tokens';

const categories = ['全部', '工作', '学习', '生活', '灵感'];

export default function NotesScreen() {
  const router = useRouter();
  const [category, setCategory] = useState('全部');
  const [showSearch, setShowSearch] = useState(false);
  const [query, setQuery] = useState('');

  const filteredNotes = useMemo(
    () =>
      notes.filter((note) => {
        const categoryMatch = category === '全部' || note.tag === category;
        const queryMatch = !query || `${note.title}${note.summary}`.includes(query);
        return categoryMatch && queryMatch;
      }),
    [category, query],
  );

  return (
    <AppScreen>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Text style={styles.pageTitle}>笔记</Text>
          <View style={styles.headerActions}>
            <Pressable
              accessibilityLabel="搜索笔记"
              hitSlop={9}
              onPress={() => setShowSearch((value) => !value)}
            >
              <AppIcon color={colors.textSecondary} name="search-outline" size={24} />
            </Pressable>
            <Pressable style={({ pressed }) => [styles.newButton, pressed && styles.pressed]}>
              <Text style={styles.newButtonText}>新建</Text>
            </Pressable>
          </View>
        </View>

        {showSearch ? (
          <View style={styles.searchBox}>
            <AppIcon color={colors.textTertiary} name="search-outline" size={18} />
            <TextInput
              autoFocus
              onChangeText={setQuery}
              placeholder="搜索笔记"
              placeholderTextColor={colors.textTertiary}
              style={styles.searchInput}
              value={query}
            />
            {query ? (
              <Pressable hitSlop={8} onPress={() => setQuery('')}>
                <AppIcon color={colors.textTertiary} name="close-circle" size={18} />
              </Pressable>
            ) : null}
          </View>
        ) : null}

        <ScrollView
          contentContainerStyle={styles.categories}
          horizontal
          showsHorizontalScrollIndicator={false}
        >
          {categories.map((item) => {
            const selected = item === category;
            return (
              <Pressable
                key={item}
                onPress={() => setCategory(item)}
                style={[styles.category, selected && styles.categorySelected]}
              >
                <Text style={[styles.categoryText, selected && styles.categoryTextSelected]}>
                  {item}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={styles.cards}>
          {filteredNotes.map((note) => (
            <Pressable
              key={note.id}
              onPress={() => router.push({ pathname: '/notes/[id]', params: { id: note.id } })}
              style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
            >
              <Text style={styles.cardTitle}>{note.title}</Text>
              <Text numberOfLines={2} style={styles.summary}>
                {note.summary}
              </Text>
              <View style={styles.cardFooter}>
                <Text style={styles.time}>{note.time}</Text>
                <View style={[styles.noteTag, { backgroundColor: note.background }]}>
                  <Text style={[styles.noteTagText, { color: note.color }]}>{note.tag}</Text>
                </View>
              </View>
            </Pressable>
          ))}
          {filteredNotes.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>没有找到相关笔记</Text>
              <Text style={styles.emptyText}>换个关键词或分类试试</Text>
            </View>
          ) : null}
        </View>
      </ScrollView>
      <AiFab count={2} />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 16,
    paddingBottom: 94,
  },
  header: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pageTitle: {
    color: colors.text,
    fontFamily,
    fontSize: 28,
    lineHeight: 36,
    fontWeight: '700',
    letterSpacing: -0.4,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 17,
  },
  newButton: {
    height: 40,
    paddingHorizontal: 16,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primarySoft,
  },
  newButtonText: {
    color: colors.primary,
    fontFamily,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.72,
  },
  searchBox: {
    height: 44,
    marginBottom: 12,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontFamily,
    fontSize: 14,
  },
  categories: {
    paddingBottom: 14,
    gap: 9,
  },
  category: {
    minWidth: 52,
    height: 36,
    paddingHorizontal: 15,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  categorySelected: {
    backgroundColor: colors.primary,
  },
  categoryText: {
    color: colors.textSecondary,
    fontFamily,
    fontSize: 13,
  },
  categoryTextSelected: {
    color: colors.background,
    fontWeight: '600',
  },
  cards: {
    gap: 14,
  },
  card: {
    minHeight: 136,
    padding: 15,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.background,
  },
  cardPressed: {
    borderColor: '#C5E9D8',
    backgroundColor: '#FCFEFD',
  },
  cardTitle: {
    color: colors.text,
    fontFamily,
    fontSize: 16,
    lineHeight: 23,
    fontWeight: '600',
  },
  summary: {
    minHeight: 43,
    marginTop: 7,
    color: colors.textSecondary,
    fontFamily,
    fontSize: 14,
    lineHeight: 21,
  },
  cardFooter: {
    marginTop: 7,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  time: {
    color: colors.textTertiary,
    fontFamily,
    fontSize: 12,
  },
  noteTag: {
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  noteTagText: {
    fontFamily,
    fontSize: 11,
    fontWeight: '500',
  },
  empty: {
    paddingVertical: 70,
    alignItems: 'center',
  },
  emptyTitle: {
    color: colors.text,
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
  },
  emptyText: {
    marginTop: 8,
    color: colors.textTertiary,
    fontFamily,
    fontSize: 13,
  },
});
