import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { AiFab } from '@/components/ui/ai-fab';
import { AppScreen } from '@/components/ui/app-screen';
import { AppIcon } from '@/components/ui/icon';
import { PageHeader } from '@/components/ui/page-header';
import { StatePanel } from '@/components/ui/state-panel';
import { notes } from '@/mocks/data';
import { colors, fontFamily, radius, typography } from '@/theme/tokens';

const tags = ['全部', '工作', '学习', '生活', '灵感'];

type NoteItem = (typeof notes)[number];

function NoteCard({ note }: { note: NoteItem }) {
  const router = useRouter();
  const hasAttachment = note.id === 'requirements-meeting' || note.id === 'dali-trip';

  return (
    <Pressable
      accessibilityLabel={`${note.title}，${note.tag}，${note.time}`}
      accessibilityRole="button"
      onPress={() => router.push({ pathname: '/notes/[id]', params: { id: note.id } })}
      style={({ pressed }) => [styles.noteCard, pressed && styles.noteCardPressed]}
    >
      <View style={styles.cardTopLine}>
        <View style={styles.noteTag}>
          <Text style={styles.noteTagText}>{note.tag}</Text>
        </View>
        <View style={styles.noteMeta}>
          {hasAttachment ? (
            <AppIcon color={colors.textTertiary} name="image-outline" size={15} />
          ) : null}
          <Text style={styles.noteTime}>{note.time}</Text>
        </View>
      </View>
      <Text numberOfLines={2} style={styles.noteTitle}>{note.title}</Text>
      <Text numberOfLines={3} style={styles.noteSummary}>{note.summary}</Text>
    </Pressable>
  );
}

export default function NotesScreen() {
  const router = useRouter();
  const [activeTag, setActiveTag] = useState('全部');
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);

  const filteredNotes = useMemo(
    () => notes.filter((note) => {
      const tagMatches = activeTag === '全部' || note.tag === activeTag;
      const queryMatches = !query.trim() || `${note.title}${note.summary}`.includes(query.trim());
      return tagMatches && queryMatches;
    }),
    [activeTag, query],
  );

  const clearFilters = () => {
    setActiveTag('全部');
    setQuery('');
  };

  const toggleSearch = () => {
    setSearchOpen((current) => {
      if (current) setQuery('');
      return !current;
    });
  };

  return (
    <AppScreen>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        style={styles.screen}
      >
        <PageHeader
          action={
            <Pressable
              accessibilityLabel={searchOpen ? '关闭笔记搜索' : '搜索笔记'}
              accessibilityRole="button"
              onPress={toggleSearch}
              style={({ pressed }) => [styles.searchButton, pressed && styles.controlPressed]}
            >
              <AppIcon
                color={searchOpen ? colors.primaryStrong : colors.text}
                name={searchOpen ? 'close' : 'search-outline'}
                size={22}
              />
            </Pressable>
          }
          subtitle={`${notes.length} 篇内容`}
          title="笔记"
        />

        {searchOpen ? (
          <View style={styles.searchBox}>
            <AppIcon color={colors.textSecondary} name="search-outline" size={18} />
            <TextInput
              autoFocus
              onChangeText={setQuery}
              placeholder="搜索笔记"
              placeholderTextColor={colors.textTertiary}
              returnKeyType="search"
              style={styles.searchInput}
              value={query}
            />
            {query ? (
              <Pressable accessibilityLabel="清空搜索" onPress={() => setQuery('')}>
                <AppIcon color={colors.textTertiary} name="close-circle" size={19} />
              </Pressable>
            ) : null}
          </View>
        ) : null}

        <ScrollView
          contentContainerStyle={styles.tagRail}
          horizontal
          showsHorizontalScrollIndicator={false}
        >
          {tags.map((tag) => {
            const selected = activeTag === tag;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected }}
                key={tag}
                onPress={() => setActiveTag(tag)}
                style={({ pressed }) => [
                  styles.tagButton,
                  selected && styles.tagButtonSelected,
                  pressed && styles.controlPressed,
                ]}
              >
                <Text style={[styles.tagButtonText, selected && styles.tagButtonTextSelected]}>
                  {tag}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {filteredNotes.length ? (
          <View style={styles.cardList}>
            {filteredNotes.map((note) => <NoteCard key={note.id} note={note} />)}
          </View>
        ) : (
          <StatePanel
            actionLabel={notes.length ? '清除筛选' : '记一件事'}
            icon="document-text-outline"
            message={notes.length ? '换个标签或关键词再看看。' : '从底部新增记录想法和资料。'}
            onAction={notes.length ? clearFilters : () => router.push('/capture/new')}
            title={notes.length ? '没有符合条件的笔记' : '还没有笔记'}
          />
        )}
      </ScrollView>

      <AiFab count={2} />
    </AppScreen>
  );
}

const cardShadow = Platform.select({
  web: {
    boxShadow: '0 10px 28px rgba(29, 64, 51, 0.065)',
  },
  default: {
    shadowColor: '#1D4033',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.065,
    shadowRadius: 18,
    elevation: 2,
  },
});

const styles = StyleSheet.create({
  screen: {
    backgroundColor: '#F5F7F6',
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 124,
  },
  searchButton: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlPressed: {
    opacity: 0.68,
    transform: [{ scale: 0.97 }],
  },
  searchBox: {
    height: 48,
    marginBottom: 12,
    paddingHorizontal: 14,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: colors.background,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontFamily,
    ...typography.input,
  },
  tagRail: {
    paddingTop: 4,
    paddingBottom: 18,
    gap: 8,
  },
  tagButton: {
    minWidth: 60,
    minHeight: 40,
    paddingHorizontal: 17,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  tagButtonSelected: {
    backgroundColor: colors.primary,
  },
  tagButtonText: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.label,
  },
  tagButtonTextSelected: {
    color: colors.background,
    fontWeight: '600',
  },
  cardList: {
    gap: 12,
  },
  noteCard: {
    minHeight: 154,
    paddingHorizontal: 18,
    paddingTop: 17,
    paddingBottom: 19,
    borderRadius: radius.xl,
    backgroundColor: colors.background,
    ...cardShadow,
  },
  noteCardPressed: {
    opacity: 0.86,
    transform: [{ scale: 0.988 }],
  },
  cardTopLine: {
    minHeight: 26,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  noteTag: {
    minHeight: 26,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primarySoft,
  },
  noteTagText: {
    color: colors.primaryStrong,
    fontFamily,
    ...typography.caption,
    fontSize: 11,
    lineHeight: 16,
  },
  noteMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  noteTime: {
    color: colors.textTertiary,
    fontFamily,
    ...typography.meta,
    fontSize: 12,
    lineHeight: 18,
  },
  noteTitle: {
    marginTop: 13,
    color: colors.text,
    fontFamily,
    fontSize: 17,
    lineHeight: 24,
    fontWeight: '600',
    letterSpacing: -0.15,
  },
  noteSummary: {
    marginTop: 6,
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
    lineHeight: 21,
  },
});
