import {
  errorMessage,
  useGetProject,
  useListEvents,
  useListNotes,
  useListRecords,
  useListTasks,
  type Project,
  type ProjectStatus,
} from '@steward/api-client';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { AppButton } from '@/components/ui/app-button';
import { AppScreen } from '@/components/ui/app-screen';
import { AppIcon } from '@/components/ui/icon';
import { ModalSheet } from '@/components/ui/modal-sheet';
import { NavHeader } from '@/components/ui/nav-header';
import { SectionTitle } from '@/components/ui/section-title';
import { StatePanel } from '@/components/ui/state-panel';
import {
  openTaskCount,
  progressLabel,
  projectStatusLabels,
  transitionsOf,
  useProjectActions,
} from '@/features/projects/use-projects';
import { colors, fontFamily, radius, typography } from '@/theme/tokens';

/**
 * 项目详情（设计说明 12.2）。
 *
 * 顶部主操作随状态变化，更多菜单覆盖完整状态机——包括归档后怎么回去。
 * 标记完成时先把未完成的 Task 数摆出来让用户决定，不自动完成它们。
 */
export default function ProjectDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const projectId = String(id ?? '');

  const query = useGetProject(projectId, { query: { enabled: Boolean(projectId) } });
  const project = query.data?.data;

  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [removing, setRemoving] = useState(false);

  const actions = useProjectActions();

  if (query.isPending) {
    return (
      <AppScreen includeBottomInset>
        <NavHeader onBack={() => router.back()} title="项目" />
        <View style={styles.loading}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </AppScreen>
    );
  }

  if (query.isError || !project) {
    return (
      <AppScreen includeBottomInset>
        <NavHeader onBack={() => router.back()} title="项目" />
        <View style={styles.content}>
          <StatePanel
            actionLabel="重试"
            icon="cloud-offline-outline"
            message={errorMessage(query.error, '暂时无法加载这个项目。')}
            onAction={() => void query.refetch()}
            title="加载失败"
          />
        </View>
      </AppScreen>
    );
  }

  const transitions = transitionsOf(project);
  const primary = transitions[0];

  const applyStatus = async (status: ProjectStatus, force = false) => {
    // 失败与否都关掉菜单：服务端要么办成了，要么有话要说，
    // 两种情况都不该让菜单继续盖在提示上面。
    setMenuOpen(false);
    if (await actions.changeStatus(project, status, force)) {
      void query.refetch();
    }
  };

  return (
    <AppScreen includeBottomInset>
      <NavHeader
        onBack={() => router.back()}
        right={
          <Pressable
            accessibilityLabel="项目的更多操作"
            accessibilityRole="button"
            onPress={() => setMenuOpen(true)}
            style={({ pressed }) => [styles.headerAction, pressed && styles.pressed]}
          >
            <AppIcon color={colors.text} name="ellipsis-horizontal" size={20} />
          </Pressable>
        }
        title="项目"
      />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Overview project={project} />

        {primary ? (
          <AppButton
            disabled={actions.busy}
            label={actions.busy ? '正在保存…' : primary.label}
            onPress={() => void applyStatus(primary.status)}
            style={styles.primaryAction}
          />
        ) : null}

        {actions.failure ? <Text style={styles.failure}>{actions.failure}</Text> : null}

        <ProjectObjects projectId={project.id} />
      </ScrollView>

      {menuOpen ? (
        <ActionMenu
          busy={actions.busy}
          onClose={() => {
            setMenuOpen(false);
            actions.dismiss();
          }}
          onDelete={() => {
            setMenuOpen(false);
            setRemoving(true);
          }}
          onRename={() => {
            setMenuOpen(false);
            setRenaming(true);
          }}
          onStatus={(status) => void applyStatus(status)}
          transitions={transitions}
        />
      ) : null}

      {renaming ? (
        <RenameSheet
          busy={actions.busy}
          failure={actions.failure}
          onClose={() => {
            setRenaming(false);
            actions.dismiss();
          }}
          onSubmit={async (title) => {
            if (await actions.rename(project, title)) {
              setRenaming(false);
              void query.refetch();
            }
          }}
          project={project}
        />
      ) : null}

      {/* 服务端拦下了标记完成：把未完成任务数摆出来，由用户决定要不要继续。 */}
      {actions.openTasksBlocked ? (
        <CompleteConfirm
          busy={actions.busy}
          onCancel={actions.dismiss}
          onConfirm={() => void applyStatus('completed', true)}
          project={project}
        />
      ) : null}

      {removing ? (
        <DeleteConfirm
          busy={actions.busy}
          failure={actions.failure}
          onCancel={() => {
            setRemoving(false);
            actions.dismiss();
          }}
          onConfirm={async () => {
            if (await actions.remove(project)) {
              setRemoving(false);
              router.back();
            }
          }}
          project={project}
        />
      ) : null}
    </AppScreen>
  );
}

/** 概览：标题、状态、目标日期与进度。 */
function Overview({ project }: { project: Project }) {
  return (
    <View style={styles.overview}>
      <Text accessibilityRole="header" style={styles.title}>
        {project.title}
      </Text>
      <View style={styles.badges}>
        <Text style={[styles.badge, statusBadgeStyle[project.status]]}>
          {projectStatusLabels[project.status]}
        </Text>
        {project.target_date ? (
          <Text style={styles.badgeMuted}>目标 {project.target_date}</Text>
        ) : null}
      </View>
      {project.description ? <Text style={styles.description}>{project.description}</Text> : null}
      <Text style={styles.progress}>{progressLabel(project)}</Text>
    </View>
  );
}

/** 项目下的内容。四类 Object 都按 project_id 从服务端取，不在客户端归类。 */
function ProjectObjects({ projectId }: { projectId: string }) {
  const router = useRouter();
  const tasks = useListTasks({ project_id: projectId, limit: 50 });
  const events = useListEvents({ project_id: projectId, limit: 50 });
  const notes = useListNotes({ project_id: projectId, limit: 50 });
  const records = useListRecords({ project_id: projectId, limit: 50 });

  const taskRows = tasks.data?.data ?? [];
  const eventRows = events.data?.data ?? [];
  const noteRows = notes.data?.data ?? [];
  const recordRows = records.data?.data ?? [];
  const empty = taskRows.length === 0 && eventRows.length === 0
    && noteRows.length === 0 && recordRows.length === 0;

  if (tasks.isPending || events.isPending || notes.isPending || records.isPending) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const objectError = tasks.error ?? events.error ?? notes.error ?? records.error;
  if (objectError) {
    return (
      <StatePanel
        actionLabel="重试"
        icon="cloud-offline-outline"
        message={errorMessage(objectError, '暂时无法加载项目内容。')}
        onAction={() => {
          void Promise.all([tasks.refetch(), events.refetch(), notes.refetch(), records.refetch()]);
        }}
        title="加载失败"
      />
    );
  }

  if (empty) {
    return (
      <StatePanel
        icon="albums-outline"
        message="这个项目还没有安排"
        title="暂无内容"
      />
    );
  }

  return (
    <>
      {taskRows.length > 0 ? (
        <>
          <SectionTitle count={`${taskRows.length} 项`} style={styles.section} title="任务" />
          <View style={styles.rows}>
            {taskRows.map((task) => (
              <ObjectRow
                done={task.status === 'done'}
                icon="checkmark-circle-outline"
                key={task.id}
                meta={task.due_date ?? '未安排'}
                onPress={() => router.push({ pathname: '/tasks/[id]', params: { id: task.id } })}
                title={task.title}
              />
            ))}
          </View>
        </>
      ) : null}

      {eventRows.length > 0 ? (
        <>
          <SectionTitle count={`${eventRows.length} 项`} style={styles.section} title="日程" />
          <View style={styles.rows}>
            {eventRows.map((event) => (
              <ObjectRow
                icon="calendar-outline"
                key={event.id}
                meta={event.start_date ?? ''}
                onPress={() => router.push({ pathname: '/events/[id]' as never, params: { id: event.id } })}
                title={event.title}
              />
            ))}
          </View>
        </>
      ) : null}

      {noteRows.length > 0 ? (
        <>
          <SectionTitle count={`${noteRows.length} 篇`} style={styles.section} title="笔记" />
          <View style={styles.rows}>
            {noteRows.map((note) => (
              <ObjectRow
                icon="document-text-outline"
                key={note.id}
                meta=""
                onPress={() => router.push({ pathname: '/notes/[id]', params: { id: note.id } })}
                title={note.title}
              />
            ))}
          </View>
        </>
      ) : null}

      {recordRows.length > 0 ? (
        <>
          <SectionTitle count={`${recordRows.length} 条`} style={styles.section} title="数据" />
          <View style={styles.rows}>
            {recordRows.map((record) => (
              <ObjectRow
                icon="analytics-outline"
                key={record.id}
                meta={record.tracker_name ?? record.tracker_id}
                title={record.title}
              />
            ))}
          </View>
        </>
      ) : null}
    </>
  );
}

function ObjectRow({
  title,
  meta,
  icon,
  done,
  onPress,
}: {
  title: string;
  meta: string;
  icon: 'checkmark-circle-outline' | 'calendar-outline' | 'document-text-outline' | 'analytics-outline';
  done?: boolean;
  onPress?: () => void;
}) {
  const body = (
    <>
      <AppIcon color={done ? colors.success : colors.textTertiary} name={icon} size={19} />
      <Text numberOfLines={1} style={[styles.objectTitle, done && styles.objectDone]}>
        {title}
      </Text>
      {meta ? <Text style={styles.objectMeta}>{meta}</Text> : null}
    </>
  );

  if (!onPress) {
    return <View style={styles.objectRow}>{body}</View>;
  }
  return (
    <Pressable
      accessibilityLabel={`打开 ${title}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.objectRow, pressed && styles.pressed]}
    >
      {body}
    </Pressable>
  );
}

/** 更多菜单：状态机的全部去向都在这里，不藏任何一条。 */
function ActionMenu({
  transitions,
  busy,
  onStatus,
  onRename,
  onDelete,
  onClose,
}: {
  transitions: { status: ProjectStatus; label: string }[];
  busy: boolean;
  onStatus: (status: ProjectStatus) => void;
  onRename: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  return (
    <Modal animationType="fade" onRequestClose={onClose} statusBarTranslucent transparent visible>
      <ModalSheet onClose={onClose}>
        <View style={styles.sheet}>
          {transitions.map((item) => (
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              key={item.status}
              onPress={() => onStatus(item.status)}
              style={({ pressed }) => [styles.menuRow, pressed && styles.pressed]}
            >
              <Text style={styles.menuText}>{item.label}</Text>
            </Pressable>
          ))}
          <Pressable
            accessibilityRole="button"
            onPress={onRename}
            style={({ pressed }) => [styles.menuRow, pressed && styles.pressed]}
          >
            <Text style={styles.menuText}>重命名</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={onDelete}
            style={({ pressed }) => [styles.menuRow, pressed && styles.pressed]}
          >
            <Text style={[styles.menuText, styles.menuDanger]}>删除项目</Text>
          </Pressable>
        </View>
      </ModalSheet>
    </Modal>
  );
}

function RenameSheet({
  project,
  busy,
  failure,
  onSubmit,
  onClose,
}: {
  project: Project;
  busy: boolean;
  failure: string | null;
  onSubmit: (title: string) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(project.title);

  return (
    <Modal animationType="fade" onRequestClose={onClose} statusBarTranslucent transparent visible>
      <ModalSheet onClose={onClose}>
        <View style={styles.sheet}>
          <Text accessibilityRole="header" style={styles.sheetTitle}>
            重命名项目
          </Text>
          <TextInput
            accessibilityLabel="项目名称"
            autoFocus
            maxLength={120}
            onChangeText={setTitle}
            onSubmitEditing={() => onSubmit(title.trim())}
            placeholder="项目名称"
            placeholderTextColor={colors.textTertiary}
            returnKeyType="done"
            style={styles.input}
            value={title}
          />
          {failure ? <Text style={styles.failure}>{failure}</Text> : null}
          <View style={styles.sheetActions}>
            <AppButton
              disabled={busy || !title.trim() || title.trim() === project.title}
              label={busy ? '正在保存…' : '保存'}
              onPress={() => onSubmit(title.trim())}
            />
            <AppButton label="取消" onPress={onClose} variant="text" />
          </View>
        </View>
      </ModalSheet>
    </Modal>
  );
}

/**
 * 标记完成前的确认。
 *
 * 说清楚未完成的任务会保持原样：用户以为「完成项目」会顺手关掉它们的话，
 * 那些任务就会在他不知道的情况下留在待办里。
 */
function CompleteConfirm({
  project,
  busy,
  onConfirm,
  onCancel,
}: {
  project: Project;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal animationType="fade" onRequestClose={onCancel} statusBarTranslucent transparent visible>
      <ModalSheet onClose={onCancel}>
        <View style={styles.sheet}>
          <Text accessibilityRole="header" style={styles.sheetTitle}>
            标记完成
          </Text>
          <Text style={styles.sheetCopy}>
            「{project.title}」还有 {openTaskCount(project)} 个没完成的任务。
            标记完成不会改动它们，它们仍会留在你的待办里。
          </Text>
          <View style={styles.sheetActions}>
            <AppButton
              disabled={busy}
              label={busy ? '正在保存…' : '仍然标记完成'}
              onPress={onConfirm}
            />
            <AppButton label="再想想" onPress={onCancel} variant="text" />
          </View>
        </View>
      </ModalSheet>
    </Modal>
  );
}

function DeleteConfirm({
  project,
  busy,
  failure,
  onConfirm,
  onCancel,
}: {
  project: Project;
  busy: boolean;
  failure: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal animationType="fade" onRequestClose={onCancel} statusBarTranslucent transparent visible>
      <ModalSheet onClose={onCancel}>
        <View style={styles.sheet}>
          <Text accessibilityRole="header" style={styles.sheetTitle}>
            删除项目
          </Text>
          <Text style={styles.sheetCopy}>
            「{project.title}」下的任务、日程和笔记都会保留，只是不再归属任何项目。
            如果只是想收起来，用归档更合适。
          </Text>
          {failure ? <Text style={styles.failure}>{failure}</Text> : null}
          <View style={styles.sheetActions}>
            <AppButton
              disabled={busy}
              label={busy ? '正在删除…' : '删除项目'}
              onPress={onConfirm}
              variant="danger"
            />
            <AppButton label="取消" onPress={onCancel} variant="text" />
          </View>
        </View>
      </ModalSheet>
    </Modal>
  );
}

const statusBadgeStyle: Record<ProjectStatus, { backgroundColor: string; color: string }> = {
  active: { backgroundColor: colors.primarySoft, color: colors.primaryStrong },
  paused: { backgroundColor: colors.surfaceSubtle, color: colors.textSecondary },
  completed: { backgroundColor: colors.surfaceSubtle, color: colors.success },
  archived: { backgroundColor: colors.surfaceSubtle, color: colors.textTertiary },
};

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  headerAction: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
  loading: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  pressed: {
    opacity: 0.6,
  },
  overview: {
    paddingTop: 4,
    paddingBottom: 16,
    gap: 8,
  },
  title: {
    color: colors.text,
    fontFamily,
    fontSize: 22,
    lineHeight: 30,
    fontWeight: '700',
  },
  badges: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: radius.pill,
    fontFamily,
    ...typography.meta,
    fontWeight: '600',
    overflow: 'hidden',
  },
  badgeMuted: {
    color: colors.textTertiary,
    fontFamily,
    ...typography.meta,
  },
  description: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.body,
  },
  progress: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  primaryAction: {
    marginBottom: 8,
  },
  section: {
    marginTop: 14,
  },
  rows: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  objectRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  objectTitle: {
    flex: 1,
    color: colors.text,
    fontFamily,
    ...typography.body,
  },
  objectDone: {
    color: colors.textTertiary,
    textDecorationLine: 'line-through',
  },
  objectMeta: {
    color: colors.textTertiary,
    fontFamily,
    ...typography.meta,
  },
  sheet: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 20,
  },
  sheetTitle: {
    marginBottom: 12,
    color: colors.text,
    fontFamily,
    ...typography.section,
  },
  sheetCopy: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.body,
  },
  sheetActions: {
    marginTop: 18,
    gap: 8,
  },
  menuRow: {
    minHeight: 52,
    justifyContent: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  menuText: {
    color: colors.text,
    fontFamily,
    ...typography.body,
  },
  menuDanger: {
    color: colors.danger,
  },
  input: {
    minHeight: 46,
    paddingHorizontal: 14,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    color: colors.text,
    fontFamily,
    ...typography.input,
  },
  failure: {
    marginTop: 12,
    color: colors.danger,
    fontFamily,
    ...typography.meta,
  },
});
