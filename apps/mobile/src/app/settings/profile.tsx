import { errorMessage } from '@steward/api-client';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
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
import { NavHeader } from '@/components/ui/nav-header';
import { SectionTitle } from '@/components/ui/section-title';
import { StatePanel } from '@/components/ui/state-panel';
import { useAccountActions, useCurrentUser } from '@/features/account/use-account';
import { colors, fontFamily, radius, typography } from '@/theme/tokens';

/**
 * 个人资料。
 *
 * 只有两件事能改：显示名称与时区。
 *
 * 时区不是展示偏好——它是所有日期语义的换算基准（“今天”“明天”“截止当天”
 * 都按它算）。改它会影响已有事项落在哪一天，所以单独说明，不和名称混在一起。
 */
export default function ProfileScreen() {
  const router = useRouter();
  const { user, loading, failed, error, refetch } = useCurrentUser();
  const actions = useAccountActions();

  const [name, setName] = useState<string | null>(null);
  const [timezone, setTimezone] = useState<string | null>(null);

  if (loading) {
    return (
      <AppScreen includeBottomInset>
        <NavHeader onBack={() => router.back()} title="个人资料" />
        <View style={styles.loading}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </AppScreen>
    );
  }

  if (failed || !user) {
    return (
      <AppScreen includeBottomInset>
        <NavHeader onBack={() => router.back()} title="个人资料" />
        <View style={styles.content}>
          <StatePanel
            actionLabel="重试"
            icon="cloud-offline-outline"
            message={errorMessage(error, '暂时无法加载个人资料。')}
            onAction={refetch}
            title="加载失败"
          />
        </View>
      </AppScreen>
    );
  }

  // 未编辑时跟随服务端值，编辑后才用本地值——不在 effect 里同步 state。
  const nameValue = name ?? user.display_name;
  const timezoneValue = timezone ?? user.timezone;
  const dirty = nameValue !== user.display_name || timezoneValue !== user.timezone;

  const save = async () => {
    if (!nameValue.trim() || !dirty) return;
    const done = await actions.updateProfile({
      display_name: nameValue.trim(),
      timezone: timezoneValue,
    });
    if (done) {
      setName(null);
      setTimezone(null);
      refetch();
    }
  };

  return (
    <AppScreen includeBottomInset>
      <NavHeader onBack={() => router.back()} title="个人资料" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <SectionTitle title="显示名称" />
        <TextInput
          accessibilityLabel="显示名称"
          maxLength={40}
          onChangeText={setName}
          placeholder="你的名字"
          placeholderTextColor={colors.textTertiary}
          style={styles.input}
          value={nameValue}
        />

        <SectionTitle style={styles.section} title="时区" />
        <View style={styles.timezoneList}>
          {commonTimezones.map((zone) => (
            <Pressable
              accessibilityLabel={`把时区设为 ${zone.label}`}
              accessibilityRole="radio"
              accessibilityState={{ checked: timezoneValue === zone.id }}
              key={zone.id}
              onPress={() => setTimezone(zone.id)}
              style={({ pressed }) => [styles.timezoneRow, pressed && styles.pressed]}
            >
              <AppIcon
                color={timezoneValue === zone.id ? colors.primaryStrong : colors.borderStrong}
                name={timezoneValue === zone.id ? 'radio-button-on' : 'radio-button-off'}
                size={19}
              />
              <View style={styles.timezoneCopy}>
                <Text style={styles.timezoneLabel}>{zone.label}</Text>
                <Text style={styles.timezoneId}>{zone.id}</Text>
              </View>
            </Pressable>
          ))}
          {/* 用户当前时区不在常用列表里时也要能看到，否则会以为没设置过。 */}
          {commonTimezones.some((zone) => zone.id === timezoneValue) ? null : (
            <View style={styles.timezoneRow}>
              <AppIcon color={colors.primaryStrong} name="radio-button-on" size={19} />
              <View style={styles.timezoneCopy}>
                <Text style={styles.timezoneLabel}>当前时区</Text>
                <Text style={styles.timezoneId}>{timezoneValue}</Text>
              </View>
            </View>
          )}
        </View>
        <Text style={styles.hint}>
          时区决定「今天」「明天」和「截止当天」怎么算。改了它，已有事项落在哪一天也会跟着变。
        </Text>

        {actions.failure ? <Text style={styles.failure}>{actions.failure}</Text> : null}

        <AppButton
          disabled={actions.busy || !dirty || !nameValue.trim()}
          label={actions.busy ? '正在保存…' : '保存'}
          onPress={() => void save()}
          style={styles.submit}
        />
      </ScrollView>
    </AppScreen>
  );
}

/**
 * 常用时区。
 *
 * 不做全量 IANA 列表：几百条滚动列表里找自己的时区比手填还慢，
 * 而这个产品的用户绝大多数落在这几个区里。不在列表里的会原样保留。
 */
const commonTimezones = [
  { id: 'Asia/Shanghai', label: '中国标准时间' },
  { id: 'Asia/Hong_Kong', label: '香港' },
  { id: 'Asia/Taipei', label: '台北' },
  { id: 'Asia/Tokyo', label: '东京' },
  { id: 'Asia/Singapore', label: '新加坡' },
  { id: 'Europe/London', label: '伦敦' },
  { id: 'America/Los_Angeles', label: '美国西部' },
  { id: 'America/New_York', label: '美国东部' },
];

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  loading: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  section: {
    marginTop: 20,
  },
  input: {
    minHeight: 48,
    paddingHorizontal: 14,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    color: colors.text,
    fontFamily,
    ...typography.input,
  },
  timezoneList: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  timezoneRow: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  timezoneCopy: {
    flex: 1,
    gap: 2,
  },
  timezoneLabel: {
    color: colors.text,
    fontFamily,
    ...typography.body,
  },
  timezoneId: {
    color: colors.textTertiary,
    fontFamily,
    ...typography.meta,
  },
  hint: {
    marginTop: 12,
    color: colors.textTertiary,
    fontFamily,
    ...typography.meta,
  },
  submit: {
    marginTop: 24,
  },
  failure: {
    marginTop: 14,
    color: colors.danger,
    fontFamily,
    ...typography.meta,
  },
  pressed: {
    opacity: 0.6,
  },
});
