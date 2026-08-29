import { errorMessage, useListNotes, type Note } from '@steward/api-client';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { AI_FAB_TAB_BAR_INSET, AiFab } from '@/components/ui/ai-fab';
import { AppScreen } from '@/components/ui/app-screen';
import { FilterChip } from '@/components/ui/filter-chip';
import { AppIcon } from '@/components/ui/icon';
import { PageHeader } from '@/components/ui/page-header';
import { StatePanel } from '@/components/ui/state-panel';
import { formatRelativeTime } from '@/utils/format';
import { colors, fontFamily, radius, typography } from '@/theme/tokens';

const ALL_TAGS = '全部';

function NoteCard({ note }: { note: Note }) {
  const router = useRouter();
  const primaryTag = note.tags[0];
  const time = formatRelativeTime(note.updated_at);
  const hasAttachment = (note.attachments?.length ?? 0) > 0;

  return (
    <Pressable
      accessibilityLabel={`${note.title}，${primaryTag ?? '无标签'}，${time}`}
      accessibilityRole="button"
      onPress={() => router.push({ pathname: '/notes/[id]', params: { id: note.id } })}
      style={({ pressed }) => [styles.noteCard, pressed && styles.noteCardPressed]}
    >
      <View style={styles.cardTopLine}>
        {primaryTag ? (
          <View style={styles.noteTag}>
            <Text style={styles.noteTagText}>{primaryTag}</Text>
          </View>
        ) : (
          <View />
        )}
        <View style={styles.noteMeta}>
          {hasAttachment ? (
            <AppIcon color={colors.textTertiary} name="image-outline" size={15} />
          ) : null}
          <Text style={styles.noteTime}>{time}</Text>
        </View>
      </View>
      <Text numberOfLines={2} style={styles.noteTitle}>{note.title}</Text>
      <Text numberOfLines={3} style={styles.noteSummary}>{note.content_plaintext}</Text>
    </Pressable>
  );
}

export default function NotesScreen() {
  const router = useRouter();
  const [activeTag, setActiveTag] = useState(ALL_TAGS);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);

  // 筛选与搜索都交给服务端：客户端不再持有全量笔记，也就不会出现
  // 「本地过滤结果」与「服务端事实」不一致的情况。
  const notesQuery = useListNotes({
    tag: activeTag === ALL_TAGS ? undefined : activeTag,
    q: query.trim() || undefined,
    limit: 50,
  });

  const notes = useMemo(() => notesQuery.data?.data ?? [], [notesQuery.data]);

  // 标签栏从当前结果里归集。等契约提供标签聚合接口后改为服务端返回。
  const tags = useMemo(() => {
    const collected = new Set<string>();
    for (const note of notes) {
      for (const tag of note.tags) collected.add(tag);
    }
    return [ALL_TAGS, ...Array.from(collected)];
  }, [notes]);

  const hasFilters = activeTag !== ALL_TAGS || query.trim().length > 0;

  const clearFilters = () => {
    setActiveTag(ALL_TAGS);
    setQuery('');
  };

  const openNewNote = () => {
    router.push('/notes/new');
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
        refreshControl={
          <RefreshControl
            onRefresh={() => void notesQuery.refetch()}
            refreshing={notesQuery.isRefetching}
          />
        }
        showsVerticalScrollIndicator={false}
        style={styles.screen}
      >
        <PageHeader
          action={
            <View style={styles.headerActions}>
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
              <Pressable
                accessibilityLabel="新建笔记"
                accessibilityRole="button"
                onPress={openNewNote}
                style={({ pressed }) => [styles.searchButton, pressed && styles.controlPressed]}
              >
                <AppIcon color={colors.text} name="add" size={24} />
              </Pressable>
            </View>
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
              <FilterChip
                key={tag}
                label={tag}
                onPress={() => setActiveTag(tag)}
                selected={selected}
              />
            );
          })}
        </ScrollView>

        {notesQuery.isPending ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : notesQuery.isError ? (
          <StatePanel
            actionLabel="重试"
            icon="cloud-offline-outline"
            message={errorMessage(notesQuery.error, '暂时无法加载笔记。')}
            onAction={() => void notesQuery.refetch()}
            title="加载失败"
          />
        ) : notes.length ? (
          <View style={styles.cardList}>
            {notes.map((note) => <NoteCard key={note.id} note={note} />)}
          </View>
        ) : (
          <StatePanel
            actionLabel={hasFilters ? '清除筛选' : '记一件事'}
            icon="document-text-outline"
            message={hasFilters ? '换个标签或关键词再看看。' : '从底部新增记录想法和资料。'}
            onAction={hasFilters ? clearFilters : openNewNote}
            title={hasFilters ? '没有符合条件的笔记' : '还没有笔记'}
          />
        )}
      </ScrollView>

      <AiFab bottomInset={AI_FAB_TAB_BAR_INSET} />
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
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  loading: {
    paddingVertical: 32,
    alignItems: 'center',
  },
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
