import {
  errorMessage,
  type Person,
  type RelationshipGroup,
  useListPeople,
} from '@steward/api-client';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { AppButton } from '@/components/ui/app-button';
import { AppIcon } from '@/components/ui/icon';
import { StatePanel } from '@/components/ui/state-panel';
import { colors, fontFamily, radius, typography } from '@/theme/tokens';

type RelationshipFilter = 'all' | RelationshipGroup;

const filters: readonly { id: RelationshipFilter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'family', label: '家人' },
  { id: 'friend', label: '朋友' },
  { id: 'colleague', label: '同事' },
  { id: 'other', label: '其他' },
];

const groupLabels: Record<RelationshipGroup, string> = {
  family: '家人',
  friend: '朋友',
  colleague: '同事',
  other: '其他',
};

export function RelationshipsContent() {
  const router = useRouter();
  const [filter, setFilter] = useState<RelationshipFilter>('all');
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim();
  const params = useMemo(() => ({
    limit: 100,
    q: normalizedQuery || undefined,
    relationship_group: filter === 'all' ? undefined : filter,
  }), [filter, normalizedQuery]);
  const peopleQuery = useListPeople(params, { query: { staleTime: 30_000 } });
  const people = peopleQuery.data?.data ?? [];

  return (
    <View style={styles.page}>
      <View style={styles.toolbarRow}>
        <View style={styles.searchField}>
          <AppIcon color={colors.textTertiary} name="search" size={19} />
          <TextInput
            accessibilityLabel="搜索亲友"
            autoCorrect={false}
            onChangeText={setQuery}
            placeholder="搜索姓名或关系"
            placeholderTextColor={colors.textSecondary}
            returnKeyType="search"
            style={styles.searchInput}
            value={query}
          />
          {query ? (
            <Pressable
              accessibilityLabel="清空搜索"
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => setQuery('')}
            >
              <AppIcon color={colors.textTertiary} name="close-circle" size={18} />
            </Pressable>
          ) : null}
        </View>
        <AppButton
          compact
          icon="person-add-outline"
          label="添加"
          onPress={() => router.push('/people/new')}
          variant="secondary"
        />
      </View>

      <View accessibilityRole="tablist" style={styles.filters}>
        {filters.map((item) => {
          const selected = filter === item.id;
          return (
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              key={item.id}
              onPress={() => setFilter(item.id)}
              style={({ pressed }) => [
                styles.filter,
                selected && styles.filterSelected,
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.filterText, selected && styles.filterTextSelected]}>
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {peopleQuery.isPending ? (
        <View style={styles.loading}><ActivityIndicator color={colors.primary} /></View>
      ) : peopleQuery.isError ? (
        <StatePanel
          actionLabel="重试"
          icon="cloud-offline-outline"
          message={errorMessage(peopleQuery.error, '亲友没有加载出来。')}
          onAction={() => void peopleQuery.refetch()}
          title="加载失败"
        />
      ) : people.length === 0 ? (
        <StatePanel
          actionLabel={normalizedQuery || filter !== 'all' ? undefined : '添加亲友'}
          icon="people-outline"
          message={normalizedQuery || filter !== 'all' ? '换个姓名或关系试试。' : undefined}
          onAction={normalizedQuery || filter !== 'all' ? undefined : () => router.push('/people/new')}
          title={normalizedQuery || filter !== 'all' ? '没有找到' : '还没有亲友'}
        />
      ) : (
        <View style={styles.list}>
          {people.map((person, index) => (
            <PersonRow
              divider={index < people.length - 1}
              key={person.id}
              onPress={() => router.push({ pathname: '/people/[id]', params: { id: person.id } })}
              person={person}
            />
          ))}
        </View>
      )}
    </View>
  );
}

function PersonRow({ divider, onPress, person }: { divider: boolean; onPress: () => void; person: Person }) {
  const relation = person.relationship_label || groupLabels[person.relationship_group];
  return (
    <Pressable
      accessibilityLabel={`${person.name}，${relation}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.personRow, pressed && styles.rowPressed]}
    >
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{person.name.trim().slice(0, 1)}</Text>
      </View>
      <View style={[styles.personBody, divider && styles.personDivider]}>
        <View style={styles.personCopy}>
          <Text numberOfLines={1} style={styles.personName}>{person.name}</Text>
          <Text numberOfLines={1} style={styles.personRelation}>{relation}</Text>
        </View>
        <AppIcon color={colors.textTertiary} name="chevron-forward" size={18} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: { gap: 18 },
  toolbarRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10 },
  searchField: {
    minHeight: 44,
    minWidth: 0,
    flex: 1,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSubtle,
  },
  searchInput: { minWidth: 0, flex: 1, paddingVertical: 0, color: colors.text, fontFamily, ...typography.input },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  filter: { minHeight: 38, paddingHorizontal: 15, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.surfaceSubtle },
  filterSelected: { backgroundColor: colors.primarySoft },
  filterText: { color: colors.textSecondary, fontFamily, ...typography.label },
  filterTextSelected: { color: colors.primaryStrong, fontWeight: '700' },
  list: { overflow: 'hidden', borderRadius: radius.lg, backgroundColor: colors.background },
  personRow: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowPressed: { opacity: 0.65 },
  avatar: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 24, backgroundColor: colors.primarySoft },
  avatarText: { color: colors.primaryStrong, fontFamily, fontSize: 18, lineHeight: 24, fontWeight: '700' },
  personBody: { minWidth: 0, minHeight: 72, flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  personDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  personCopy: { minWidth: 0, flex: 1, gap: 2 },
  personName: { color: colors.text, fontFamily, ...typography.bodyStrong },
  personRelation: { color: colors.textSecondary, fontFamily, ...typography.meta },
  loading: { minHeight: 180, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.72 },
});
