import { useMemo, useState } from 'react';
import {
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { AppIcon } from '@/components/ui/icon';
import { ModalSheet } from '@/components/ui/modal-sheet';
import { StatePanel } from '@/components/ui/state-panel';
import { colors, fontFamily, radius, typography } from '@/theme/tokens';
import { relationshipColors } from './theme';

type RelationshipGroup = 'family' | 'friends' | 'colleagues';
type RelationshipFilter = 'all' | RelationshipGroup;

type RelationshipPerson = {
  id: string;
  name: string;
  relation: string;
  group: RelationshipGroup;
  context: string;
  lastContact: string;
  nextStep: string;
  action?: string;
  avatar: number;
};

const filters: readonly { id: RelationshipFilter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'family', label: '家人' },
  { id: 'friends', label: '朋友' },
  { id: 'colleagues', label: '同事' },
];

const previewPeople: readonly RelationshipPerson[] = [
  {
    id: 'mother',
    name: '妈妈',
    relation: '家人',
    group: 'family',
    context: '生日还有 7 天',
    lastContact: '昨天联系',
    nextStep: '提前准备生日礼物',
    action: '准备',
    avatar: require('../../../assets/relationship-demo/mother.png'),
  },
  {
    id: 'xiaolin',
    name: '小林',
    relation: '朋友',
    group: 'friends',
    context: '明天面试，上次聊到准备材料',
    lastContact: '昨天联系',
    nextStep: '面试结束后问问结果',
    action: '提醒',
    avatar: require('../../../assets/relationship-demo/xiaolin.png'),
  },
  {
    id: 'teacher-wang',
    name: '王老师',
    relation: '老师',
    group: 'colleagues',
    context: '周日一起吃饭',
    lastContact: '前天联系',
    nextStep: '确认餐厅和时间',
    action: '查看',
    avatar: require('../../../assets/relationship-demo/teacher-wang.png'),
  },
  {
    id: 'azhe',
    name: '阿哲',
    relation: '朋友',
    group: 'friends',
    context: '一起去过青岛',
    lastContact: '昨天',
    nextStep: '下次见面带上旅行照片',
    avatar: require('../../../assets/relationship-demo/azhe.png'),
  },
  {
    id: 'xiaxia',
    name: '小夏',
    relation: '朋友',
    group: 'friends',
    context: '最近在准备搬家',
    lastContact: '3 天前',
    nextStep: '问问搬家是否需要帮忙',
    avatar: require('../../../assets/relationship-demo/xiaxia.png'),
  },
  {
    id: 'uncle-chen',
    name: '陈叔',
    relation: '长辈',
    group: 'family',
    context: '答应推荐一本书',
    lastContact: '上周',
    nextStep: '把书名发给陈叔',
    avatar: require('../../../assets/relationship-demo/uncle-chen.png'),
  },
] as const;

const todayIds = new Set(['mother', 'xiaolin', 'teacher-wang']);
const recentIds = new Set(['azhe', 'xiaxia', 'uncle-chen']);

function matchesPerson(
  person: RelationshipPerson,
  filter: RelationshipFilter,
  query: string,
) {
  if (filter !== 'all' && person.group !== filter) return false;
  const keyword = query.trim().toLocaleLowerCase('zh-CN');
  if (!keyword) return true;
  return [person.name, person.relation, person.context, person.lastContact, person.nextStep]
    .join(' ')
    .toLocaleLowerCase('zh-CN')
    .includes(keyword);
}

/**
 * 亲友分区的开发期视觉预览。
 *
 * 正式构建不会展示示例人物；后续必须先引入 Person 契约、用户隔离、删除保留和
 * AI Candidate 确认链路，才能把本组件替换为真实 Query。
 */
export function RelationshipsContent() {
  if (!__DEV__) {
    return (
      <View style={styles.productionState}>
        <StatePanel
          icon="person-outline"
          message="以后可以在这里整理重要的人、共同经历与关心提醒；当前不会读取通讯录、保存人物资料或调用 AI。"
          title="亲友正在准备"
        />
      </View>
    );
  }

  return <RelationshipsPreview />;
}

function RelationshipsPreview() {
  const [filter, setFilter] = useState<RelationshipFilter>('all');
  const [query, setQuery] = useState('');
  const [selectedPerson, setSelectedPerson] = useState<RelationshipPerson | null>(null);
  const [showPreviewNotice, setShowPreviewNotice] = useState(false);

  const matchingPeople = useMemo(
    () => previewPeople.filter((person) => matchesPerson(person, filter, query)),
    [filter, query],
  );
  const todayPeople = matchingPeople.filter((person) => todayIds.has(person.id));
  const recentPeople = matchingPeople.filter((person) => recentIds.has(person.id));

  return (
    <View style={styles.page}>
      <View style={styles.toolbarRow}>
        <View style={styles.searchField}>
          <AppIcon color={colors.textTertiary} name="search" size={19} />
          <TextInput
            accessibilityLabel="搜索亲友"
            autoCorrect={false}
            onChangeText={setQuery}
            placeholder="搜索姓名或近况"
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
              style={({ pressed }) => pressed && styles.pressed}
            >
              <AppIcon color={colors.textTertiary} name="close-circle" size={18} />
            </Pressable>
          ) : null}
        </View>
        <Pressable
          accessibilityLabel="添加亲友"
          accessibilityRole="button"
          onPress={() => setShowPreviewNotice(true)}
          style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}
        >
          <AppIcon color={relationshipColors.strong} name="person-outline" size={18} />
          <Text style={styles.addButtonText}>添加亲友</Text>
        </Pressable>
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

      {matchingPeople.length === 0 ? (
        <View style={styles.emptyState}>
          <AppIcon color={relationshipColors.primary} name="search" size={24} />
          <Text style={styles.emptyTitle}>没有找到相关亲友</Text>
          <Text style={styles.emptyCopy}>换一个姓名、近况或关系试试。</Text>
        </View>
      ) : (
        <>
          {todayPeople.length > 0 ? (
            <RelationshipSection title="今天要关心">
              {todayPeople.map((person, index) => (
                <PersonRow
                  compact
                  divider={index < todayPeople.length - 1}
                  key={person.id}
                  onPress={() => setSelectedPerson(person)}
                  person={person}
                  showAction
                />
              ))}
            </RelationshipSection>
          ) : null}

          {recentPeople.length > 0 ? (
            <RelationshipSection title="最近联系">
              {recentPeople.map((person, index) => (
                <PersonRow
                  divider={index < recentPeople.length - 1}
                  key={person.id}
                  onPress={() => setSelectedPerson(person)}
                  person={person}
                />
              ))}
            </RelationshipSection>
          ) : null}

          <RelationshipSection count={`${matchingPeople.length} 人`} title="全部亲友">
            {matchingPeople.map((person, index) => (
              <PersonRow
                divider={index < matchingPeople.length - 1}
                key={person.id}
                onPress={() => setSelectedPerson(person)}
                person={person}
                showRelation
              />
            ))}
          </RelationshipSection>
        </>
      )}

      <PersonPreviewSheet onClose={() => setSelectedPerson(null)} person={selectedPerson} />
      <PreviewNoticeSheet
        onClose={() => setShowPreviewNotice(false)}
        visible={showPreviewNotice}
      />
    </View>
  );
}

function RelationshipSection({
  children,
  count,
  title,
}: {
  children: React.ReactNode;
  count?: string;
  title: string;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>{title}</Text>
        {count ? <Text style={styles.sectionCount}>{count}</Text> : null}
      </View>
      <View>{children}</View>
    </View>
  );
}

function PersonRow({
  compact = false,
  divider,
  onPress,
  person,
  showAction = false,
  showRelation = false,
}: {
  compact?: boolean;
  divider: boolean;
  onPress: () => void;
  person: RelationshipPerson;
  showAction?: boolean;
  showRelation?: boolean;
}) {
  return (
    <Pressable
      accessibilityLabel={`${person.name}，${person.relation}，${person.context}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.personRow, pressed && styles.rowPressed]}
    >
      <Image resizeMode="cover" source={person.avatar} style={styles.personAvatar} />
      <View style={[styles.personBody, divider && styles.personDivider]}>
        <View style={styles.personCopy}>
          <View style={styles.personTitleLine}>
            <Text numberOfLines={1} style={styles.personName}>{person.name}</Text>
            {compact || showRelation ? (
              <Text numberOfLines={1} style={styles.personRelation}>· {person.relation}</Text>
            ) : (
              <Text style={styles.personTime}>{person.lastContact}</Text>
            )}
          </View>
          <Text numberOfLines={1} style={styles.personContext}>{person.context}</Text>
        </View>
        {showAction && person.action ? (
          <Text style={styles.rowAction}>{person.action}</Text>
        ) : (
          <AppIcon color={colors.textTertiary} name="chevron-forward" size={17} />
        )}
      </View>
    </Pressable>
  );
}

function PersonPreviewSheet({
  onClose,
  person,
}: {
  onClose: () => void;
  person: RelationshipPerson | null;
}) {
  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
      transparent
      visible={person !== null}
    >
      <ModalSheet maxHeight="78%" onClose={onClose}>
        {person ? (
          <View style={styles.detailSheet}>
            <View style={styles.detailHeader}>
              <Image resizeMode="cover" source={person.avatar} style={styles.detailAvatar} />
              <View style={styles.detailHeaderCopy}>
                <Text accessibilityRole="header" style={styles.detailName}>{person.name}</Text>
                <Text style={styles.detailRelation}>{person.relation}</Text>
              </View>
              <Pressable
                accessibilityLabel="关闭亲友详情"
                accessibilityRole="button"
                onPress={onClose}
                style={({ pressed }) => [styles.detailClose, pressed && styles.pressed]}
              >
                <AppIcon color={colors.textSecondary} name="close" size={21} />
              </Pressable>
            </View>
            <DetailFact icon="time-outline" label="最近联系" value={person.lastContact} />
            <DetailFact icon="heart-outline" label="记住的事" value={person.context} />
            <DetailFact icon="notifications-outline" label="接下来" value={person.nextStep} />
          </View>
        ) : null}
      </ModalSheet>
    </Modal>
  );
}

function DetailFact({
  icon,
  label,
  value,
}: {
  icon: React.ComponentProps<typeof AppIcon>['name'];
  label: string;
  value: string;
}) {
  return (
    <View style={styles.detailFact}>
      <View style={styles.detailFactIcon}>
        <AppIcon color={relationshipColors.strong} name={icon} size={18} />
      </View>
      <View style={styles.detailFactCopy}>
        <Text style={styles.detailFactLabel}>{label}</Text>
        <Text style={styles.detailFactValue}>{value}</Text>
      </View>
    </View>
  );
}

function PreviewNoticeSheet({ onClose, visible }: { onClose: () => void; visible: boolean }) {
  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
      transparent
      visible={visible}
    >
      <ModalSheet maxHeight="60%" onClose={onClose}>
        <View style={styles.noticeSheet}>
          <View style={styles.noticeIcon}>
            <AppIcon color={relationshipColors.strong} name="person-outline" size={24} />
          </View>
          <Text accessibilityRole="header" style={styles.noticeTitle}>新增亲友将在正式版开放</Text>
          <Text style={styles.noticeCopy}>
            第一版会优先支持手动添加。只有用户主动选择时才调用系统联系人选择器，不申请整本通讯录访问。
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={onClose}
            style={({ pressed }) => [styles.noticeButton, pressed && styles.pressed]}
          >
            <Text style={styles.noticeButtonText}>知道了</Text>
          </Pressable>
        </View>
      </ModalSheet>
    </Modal>
  );
}

const styles = StyleSheet.create({
  productionState: {
    paddingTop: 24,
  },
  page: {
    paddingTop: 12,
  },
  toolbarRow: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  addButton: {
    minHeight: 46,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: radius.sm,
    backgroundColor: relationshipColors.soft,
  },
  addButtonText: {
    color: relationshipColors.strong,
    fontFamily,
    ...typography.label,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.56,
  },
  searchField: {
    flex: 1,
    minWidth: 0,
    minHeight: 46,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderRadius: radius.md,
    backgroundColor: relationshipColors.surface,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 0,
    color: colors.text,
    fontFamily,
    ...typography.input,
  },
  filters: {
    marginTop: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  filter: {
    minHeight: 40,
    paddingHorizontal: 17,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  filterSelected: {
    backgroundColor: relationshipColors.soft,
  },
  filterText: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.label,
  },
  filterTextSelected: {
    color: relationshipColors.strong,
    fontWeight: '600',
  },
  section: {
    marginTop: 22,
  },
  sectionHeader: {
    minHeight: 31,
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  sectionTitle: {
    color: colors.text,
    fontFamily,
    fontSize: 18,
    lineHeight: 25,
    fontWeight: '600',
  },
  sectionCount: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  personRow: {
    minHeight: 66,
    flexDirection: 'row',
    alignItems: 'center',
  },
  rowPressed: {
    backgroundColor: relationshipColors.surface,
  },
  personAvatar: {
    width: 44,
    height: 44,
    marginLeft: 4,
    marginRight: 12,
    borderRadius: 22,
    backgroundColor: relationshipColors.soft,
  },
  personBody: {
    minHeight: 66,
    flex: 1,
    minWidth: 0,
    paddingRight: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  personDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  personCopy: {
    flex: 1,
    minWidth: 0,
  },
  personTitleLine: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 5,
  },
  personName: {
    maxWidth: '56%',
    color: colors.text,
    fontFamily,
    ...typography.bodyStrong,
  },
  personRelation: {
    flexShrink: 1,
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  personTime: {
    flexShrink: 1,
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  personContext: {
    marginTop: 1,
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  rowAction: {
    minWidth: 44,
    color: relationshipColors.strong,
    fontFamily,
    ...typography.label,
    fontWeight: '600',
    textAlign: 'right',
  },
  emptyState: {
    marginTop: 24,
    paddingVertical: 36,
    alignItems: 'center',
    borderRadius: radius.lg,
    backgroundColor: relationshipColors.surface,
  },
  emptyTitle: {
    marginTop: 10,
    color: colors.text,
    fontFamily,
    ...typography.section,
  },
  emptyCopy: {
    marginTop: 4,
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  detailSheet: {
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 28,
  },
  detailHeader: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
  },
  detailAvatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: relationshipColors.soft,
  },
  detailHeaderCopy: {
    flex: 1,
    minWidth: 0,
    marginLeft: 14,
  },
  detailName: {
    color: colors.text,
    fontFamily,
    ...typography.detail,
  },
  detailRelation: {
    marginTop: 1,
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  detailClose: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailFact: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  detailFactIcon: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    backgroundColor: relationshipColors.soft,
  },
  detailFactCopy: {
    flex: 1,
    minWidth: 0,
    marginLeft: 12,
  },
  detailFactLabel: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  detailFactValue: {
    marginTop: 2,
    color: colors.text,
    fontFamily,
    ...typography.body,
  },
  noticeSheet: {
    paddingHorizontal: 24,
    paddingTop: 22,
    paddingBottom: 28,
    alignItems: 'center',
  },
  noticeIcon: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: relationshipColors.soft,
  },
  noticeTitle: {
    marginTop: 14,
    color: colors.text,
    fontFamily,
    ...typography.section,
    textAlign: 'center',
  },
  noticeCopy: {
    maxWidth: 320,
    marginTop: 8,
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
    textAlign: 'center',
  },
  noticeButton: {
    minWidth: 132,
    minHeight: 44,
    marginTop: 22,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: relationshipColors.primary,
  },
  noticeButtonText: {
    color: colors.background,
    fontFamily,
    ...typography.label,
    fontWeight: '600',
  },
});
