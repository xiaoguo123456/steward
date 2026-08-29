import { errorMessage } from '@steward/api-client';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { AiFab } from '@/components/ui/ai-fab';
import { AppButton } from '@/components/ui/app-button';
import { AppScreen } from '@/components/ui/app-screen';
import { FlatListGroup, FlatListRow } from '@/components/ui/flat-list';
import { AppIcon } from '@/components/ui/icon';
import { ModalSheet } from '@/components/ui/modal-sheet';
import { NavHeader } from '@/components/ui/nav-header';
import { StatePanel } from '@/components/ui/state-panel';
import { useToast } from '@/components/ui/toast';
import {
  avatarInitial,
  preferencesSummary,
  useAccountActions,
  useCurrentUser,
  useUserPreferences,
} from '@/features/account/use-account';
import { openPublicPage } from '@/features/legal/open-public-page';
import { publicPagePaths, type PublicPagePath } from '@/features/legal/public-pages';
import {
  deleteAccountCaptureDrafts,
  listCaptureDrafts,
} from '@/features/capture/capture-draft-store';
import { session } from '@/api/session';
import { colors, fontFamily, radius, typography } from '@/theme/tokens';

/**
 * “我的”。
 *
 * 已接通的设置直接在这里分组，不再通过“全部设置”或“账号与登录”增加中转层。
 * 显示名称是短编辑，在当前上下文的底部面板完成；时区由设备自动同步。
 */
export default function MeScreen() {
  const router = useRouter();
  const toast = useToast();
  const { user, loading, failed, error, refetch } = useCurrentUser();
  const { preferences } = useUserPreferences();
  const actions = useAccountActions();
  const [editingProfile, setEditingProfile] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const [deviceDraftCount, setDeviceDraftCount] = useState(0);

  const openPage = (path: PublicPagePath) => {
    void openPublicPage(path).catch(() => {
      toast.showToast('公开页面暂时打不开，请稍后重试');
    });
  };

  const openProfileEditor = () => {
    if (!user) return;
    actions.dismiss();
    setDraftName(user.display_name);
    setEditingProfile(true);
  };

  const closeProfileEditor = () => {
    if (actions.busy) return;
    actions.dismiss();
    setEditingProfile(false);
  };

  const saveProfile = async () => {
    const displayName = draftName.trim();
    if (!user || !displayName || displayName === user.display_name || actions.busy) return;

    const saved = await actions.updateProfile({ display_name: displayName });
    if (!saved) return;

    setEditingProfile(false);
    refetch();
    toast.showToast('资料已更新');
  };

  return (
    <AppScreen includeBottomInset>
      <NavHeader title="我的" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {failed ? (
          <StatePanel
            actionLabel="重试"
            icon="cloud-offline-outline"
            message={errorMessage(error, '暂时无法加载个人资料。')}
            onAction={refetch}
            title="资料加载失败"
          />
        ) : loading ? (
          <MeSkeleton />
        ) : user ? (
          <Pressable
            accessibilityHint="头像会随名字首字更新，在当前页面打开编辑面板"
            accessibilityLabel="编辑显示名称"
            accessibilityRole="button"
            onPress={openProfileEditor}
            style={({ pressed }) => [styles.profile, pressed && styles.pressed]}
          >
            <Avatar displayName={user.display_name} />
            <View style={styles.profileCopy}>
              <Text style={styles.name}>{user.display_name}</Text>
              {/* 手机号由服务端脱敏后下发，客户端不做还原也不做拼接。 */}
              <Text style={styles.phone}>{user.phone}</Text>
            </View>
            <AppIcon color={colors.borderStrong} name="create-outline" size={18} />
          </Pressable>
        ) : null}

        <Text accessibilityRole="header" style={styles.groupTitle}>
          偏好
        </Text>
        <FlatListGroup>
		  <FlatListRow
			icon="time-outline"
			onPress={() => router.push('/settings/captures')}
			subtitle="设备草稿与离线上传队列"
			title="最近输入"
		  />
          <FlatListRow
            icon="time-outline"
            onPress={() => router.push('/settings/preferences')}
            subtitle={preferencesSummary(preferences)}
            title="时间与作息"
          />
          <FlatListRow
            icon="sparkles-outline"
            onPress={() => router.push('/settings/ai')}
            subtitle="智能整理与建议"
            title="AI 设置"
          />
          <FlatListRow
            icon="bookmark-outline"
            onPress={() => router.push('/settings/memories')}
            subtitle="助理记住的长期偏好"
            title="长期记忆"
          />
          <FlatListRow
            icon="timer-outline"
            onPress={() => router.push('/focus')}
            showDivider={false}
            title="专注设置"
          />
        </FlatListGroup>

        <Text accessibilityRole="header" style={styles.groupTitle}>
          账号
        </Text>
        <FlatListGroup>
          <FlatListRow
            icon="phone-portrait-outline"
            onPress={user ? () => router.push('/settings/phone') : undefined}
            subtitle={user?.phone}
            title="手机号"
          />
          <FlatListRow
            icon="trash-outline"
			onPress={() => router.push('/account-deletion')}
            showDivider={false}
            subtitle="查看删除范围、处理步骤与当前开放状态"
            title="账号与数据删除"
          />
        </FlatListGroup>

        <Text accessibilityRole="header" style={styles.groupTitle}>
          法律与支持
        </Text>
        <FlatListGroup>
          <FlatListRow
            icon="shield-checkmark-outline"
            onPress={() => openPage(publicPagePaths.privacy)}
            title="隐私政策"
          />
          <FlatListRow
            icon="document-text-outline"
            onPress={() => openPage(publicPagePaths.terms)}
            title="用户协议"
          />
          <FlatListRow
            icon="list-outline"
            onPress={() => openPage(publicPagePaths.personalInformation)}
            title="个人信息收集清单"
          />
          <FlatListRow
            icon="link"
            onPress={() => openPage(publicPagePaths.thirdParties)}
            title="第三方信息共享清单"
          />
          <FlatListRow
            icon="information-circle-outline"
            onPress={() => openPage(publicPagePaths.support)}
            showDivider={false}
            title="帮助与联系我们"
          />
        </FlatListGroup>

        <View style={styles.dangerZone}>
          <Text accessibilityRole="header" style={styles.groupTitle}>
            账号操作
          </Text>
          <AppButton
            disabled={actions.busy}
            label="退出登录"
			onPress={() => {
			  const accountId = session.userId();
			  if (!accountId) return;
			  void listCaptureDrafts(accountId).then((drafts) => {
				setDeviceDraftCount(drafts.filter((draft) => draft.status !== 'submitted').length);
				setConfirmingSignOut(true);
			  });
			}}
            variant="danger"
          />
        </View>
      </ScrollView>
      <AiFab />

      {editingProfile && user ? (
        <Modal
          animationType="fade"
          onRequestClose={closeProfileEditor}
          statusBarTranslucent
          transparent
          visible
        >
          <ModalSheet maxHeight="78%" minHeight={350} onClose={closeProfileEditor}>
            <ScrollView
              contentContainerStyle={styles.sheet}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.sheetHeader}>
                <Text accessibilityRole="header" style={styles.sheetTitle}>
                  编辑资料
                </Text>
                <Pressable
                  accessibilityLabel="取消编辑"
                  accessibilityRole="button"
                  disabled={actions.busy}
                  hitSlop={8}
                  onPress={closeProfileEditor}
                  style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
                >
                  <AppIcon color={colors.textSecondary} name="close" size={20} />
                </Pressable>
              </View>

              <View style={styles.avatarPreview}>
                <Avatar displayName={draftName} large />
                <Text style={styles.avatarHint}>头像使用名字首字生成</Text>
              </View>

              <Text style={styles.fieldLabel}>显示名称</Text>
              <TextInput
                accessibilityLabel="显示名称"
                autoFocus
                editable={!actions.busy}
                enterKeyHint="done"
                maxLength={40}
                onChangeText={(value) => {
                  actions.dismiss();
                  setDraftName(value);
                }}
                onSubmitEditing={() => void saveProfile()}
                placeholder="你的名字"
                placeholderTextColor={colors.textTertiary}
                returnKeyType="done"
                style={styles.input}
                value={draftName}
              />
              <Text style={styles.counter}>{[...draftName].length}/40</Text>

              {actions.failure ? (
                <Text
                  accessibilityLiveRegion="assertive"
                  accessibilityRole="alert"
                  style={styles.failure}
                >
                  {actions.failure}
                </Text>
              ) : null}

              <View style={styles.sheetActions}>
                <AppButton
                  disabled={
                    actions.busy ||
                    !draftName.trim() ||
                    draftName.trim() === user.display_name
                  }
                  label={actions.busy ? '正在保存…' : '保存'}
                  onPress={() => void saveProfile()}
                />
                <AppButton
                  disabled={actions.busy}
                  label="取消"
                  onPress={closeProfileEditor}
                  variant="text"
                />
              </View>
            </ScrollView>
          </ModalSheet>
        </Modal>
      ) : null}

      {confirmingSignOut ? (
        <Modal
          animationType="fade"
          onRequestClose={() => {
            if (!actions.busy) setConfirmingSignOut(false);
          }}
          statusBarTranslucent
          transparent
          visible
        >
          <ModalSheet
            onClose={() => {
              if (!actions.busy) setConfirmingSignOut(false);
            }}
          >
            <View style={styles.sheet}>
              <Text accessibilityRole="header" style={styles.sheetTitle}>
                退出登录？
              </Text>
              <Text style={styles.sheetCopy}>
				{deviceDraftCount > 0
				  ? `这台设备还有 ${deviceDraftCount} 条未提交输入。你可以为当前账号保留，或在退出时一并删除。其他账号无法看到这些草稿。`
				  : '退出后需要重新用手机号登录。服务端内容不会被删除。'}
              </Text>
              <View style={styles.sheetActions}>
                <AppButton
                  disabled={actions.busy}
				  label={actions.busy ? '正在退出…' : deviceDraftCount > 0 ? '保留草稿并退出' : '退出登录'}
                  onPress={async () => {
                    await actions.signOut();
                    setConfirmingSignOut(false);
                    router.replace('/');
                  }}
                  variant="danger"
                />
				{deviceDraftCount > 0 ? (
				  <AppButton
					disabled={actions.busy}
					label="删除设备草稿并退出"
					onPress={async () => {
					  const accountId = session.userId();
					  if (accountId) await deleteAccountCaptureDrafts(accountId);
					  await actions.signOut();
					  setConfirmingSignOut(false);
					  router.replace('/');
					}}
					variant="danger"
				  />
				) : null}
                <AppButton
                  disabled={actions.busy}
                  label="取消"
                  onPress={() => setConfirmingSignOut(false)}
                  variant="text"
                />
              </View>
            </View>
          </ModalSheet>
        </Modal>
      ) : null}
    </AppScreen>
  );
}

function Avatar({ displayName, large = false }: { displayName: string; large?: boolean }) {
  return (
    <View style={[styles.avatar, large && styles.avatarLarge]}>
      <Text style={[styles.avatarText, large && styles.avatarTextLarge]}>
        {avatarInitial(displayName)}
      </Text>
    </View>
  );
}

function MeSkeleton() {
  return (
    <View accessibilityLabel="正在加载个人资料">
      <View style={styles.profileSkeleton}>
        <View style={[styles.skeletonBlock, styles.avatarSkeleton]} />
        <View style={styles.profileSkeletonCopy}>
          <View style={[styles.skeletonBlock, styles.nameSkeleton]} />
          <View style={[styles.skeletonBlock, styles.phoneSkeleton]} />
        </View>
      </View>
      {[0, 1, 2].map((group) => (
        <View key={group}>
          <View style={[styles.skeletonBlock, styles.groupTitleSkeleton]} />
          <View style={styles.groupSkeleton}>
            {[0, 1, 2].map((row) => (
              <View key={row} style={styles.rowSkeleton}>
                <View style={[styles.skeletonBlock, styles.rowIconSkeleton]} />
                <View style={[styles.skeletonBlock, styles.rowTextSkeleton]} />
              </View>
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 92,
  },
  skeletonBlock: {
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  profileSkeleton: {
    minHeight: 84,
    paddingHorizontal: 14,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceSubtle,
  },
  avatarSkeleton: {
    width: 48,
    height: 48,
    marginRight: 12,
    borderRadius: radius.md,
  },
  profileSkeletonCopy: {
    flex: 1,
    gap: 8,
  },
  nameSkeleton: {
    width: 104,
    height: 16,
  },
  phoneSkeleton: {
    width: 138,
    height: 12,
  },
  groupTitleSkeleton: {
    width: 62,
    height: 16,
    marginTop: 28,
    marginBottom: 12,
  },
  groupSkeleton: {
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
  },
  rowSkeleton: {
    minHeight: 60,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowIconSkeleton: {
    width: 28,
    height: 28,
    borderRadius: radius.sm,
  },
  rowTextSkeleton: {
    width: '48%',
    height: 14,
  },
  profile: {
    minHeight: 84,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: radius.lg,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceSubtle,
  },
  pressed: {
    opacity: 0.68,
  },
  avatar: {
    width: 48,
    height: 48,
    marginRight: 12,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  avatarLarge: {
    width: 64,
    height: 64,
    marginRight: 0,
    borderRadius: radius.lg,
  },
  avatarText: {
    color: colors.background,
    fontFamily,
    ...typography.section,
    fontSize: 18,
  },
  avatarTextLarge: {
    fontSize: 24,
    lineHeight: 32,
  },
  profileCopy: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    color: colors.text,
    fontFamily,
    ...typography.bodyStrong,
  },
  phone: {
    marginTop: 2,
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  groupTitle: {
    marginTop: 24,
    marginBottom: 10,
    color: colors.text,
    fontFamily,
    ...typography.section,
  },
  dangerZone: {
    marginTop: 8,
  },
  sheet: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 20,
  },
  sheetHeader: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sheetTitle: {
    flex: 1,
    color: colors.text,
    fontFamily,
    ...typography.section,
  },
  closeButton: {
    width: 44,
    height: 44,
    marginRight: -12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarPreview: {
    marginTop: 12,
    alignItems: 'center',
  },
  avatarHint: {
    marginTop: 8,
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  fieldLabel: {
    marginTop: 20,
    marginBottom: 8,
    color: colors.text,
    fontFamily,
    ...typography.label,
  },
  input: {
    minHeight: 52,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    color: colors.text,
    fontFamily,
    ...typography.input,
  },
  counter: {
    marginTop: 5,
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
    textAlign: 'right',
  },
  failure: {
    marginTop: 10,
    color: colors.danger,
    fontFamily,
    ...typography.meta,
  },
  sheetCopy: {
    marginTop: 10,
    color: colors.textSecondary,
    fontFamily,
    ...typography.body,
  },
  sheetActions: {
    marginTop: 18,
    gap: 8,
  },
});
