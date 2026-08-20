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
import { NavHeader } from '@/components/ui/nav-header';
import { SectionTitle } from '@/components/ui/section-title';
import { StatePanel } from '@/components/ui/state-panel';
import { useCurrentUser } from '@/features/account/use-account';
import { isPhone, useChangePhone } from '@/features/account/use-change-phone';
import { colors, fontFamily, radius, typography } from '@/theme/tokens';

/**
 * 更换绑定手机号。
 *
 * 要两个验证码：当前号的和新号的。手机号就是这个产品的账号，
 * 换绑是权限最高的操作——只验新号的话，别人拿到你没锁的手机就能把号码换走，
 * 而你再也登不进来。
 */
export default function ChangePhoneScreen() {
  const router = useRouter();
  const { user, loading, failed, error, refetch } = useCurrentUser();
  const change = useChangePhone();

  const [currentCode, setCurrentCode] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newCode, setNewCode] = useState('');
  const [done, setDone] = useState(false);

  const newPhoneValid = isPhone(newPhone);
  const ready =
    currentCode.length === 6 && newCode.length === 6 && newPhoneValid && !change.saving;

  if (loading) {
    return (
      <AppScreen includeBottomInset>
        <NavHeader onBack={() => router.back()} title="更换手机号" />
        <View style={styles.loading}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </AppScreen>
    );
  }

  if (failed || !user) {
    return (
      <AppScreen includeBottomInset>
        <NavHeader onBack={() => router.back()} title="更换手机号" />
        <View style={styles.content}>
          <StatePanel
            actionLabel="重试"
            icon="cloud-offline-outline"
            message={errorMessage(error, '暂时无法加载账号信息。')}
            onAction={refetch}
            title="加载失败"
          />
        </View>
      </AppScreen>
    );
  }

  if (done) {
    return (
      <AppScreen includeBottomInset>
        <NavHeader onBack={() => router.back()} title="更换手机号" />
        <View style={styles.content}>
          <StatePanel
            actionLabel="返回"
            icon="checkmark-circle-outline"
            message={`以后请用 ${newPhone} 登录。其他设备上的登录已经退出，这台设备不受影响。`}
            onAction={() => router.back()}
            title="换绑完成"
          />
        </View>
      </AppScreen>
    );
  }

  const submit = async () => {
    if (!ready) return;
    if (await change.submit({ currentCode, newPhone: newPhone.trim(), newCode })) {
      setDone(true);
    }
  };

  return (
    <AppScreen includeBottomInset>
      <NavHeader onBack={() => router.back()} title="更换手机号" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.intro}>
          手机号就是你的账号。换绑需要同时验证现在这个号和新号，
          确认之后其他设备上的登录会退出。
        </Text>

        <SectionTitle style={styles.section} title="验证当前手机号" />
        <View style={styles.row}>
          <Text style={styles.currentPhone}>{user.phone}</Text>
          <SendCodeButton
            busy={change.sending === 'current'}
            onPress={() => void change.sendCurrentCode()}
            sent={change.sentTo.current}
          />
        </View>
        <TextInput
          accessibilityLabel="当前手机号收到的验证码"
          keyboardType="number-pad"
          maxLength={6}
          onChangeText={setCurrentCode}
          placeholder="6 位验证码"
          placeholderTextColor={colors.textTertiary}
          style={styles.input}
          value={currentCode}
        />

        <SectionTitle style={styles.section} title="验证新手机号" />
        <TextInput
          accessibilityLabel="新手机号"
          keyboardType="phone-pad"
          maxLength={11}
          onChangeText={setNewPhone}
          placeholder="新手机号"
          placeholderTextColor={colors.textTertiary}
          style={styles.input}
          value={newPhone}
        />
        {newPhone.length > 0 && !newPhoneValid ? (
          <Text style={styles.hint}>请输入 11 位手机号。</Text>
        ) : null}
        <View style={styles.row}>
          <View style={styles.grow}>
            <TextInput
              accessibilityLabel="新手机号收到的验证码"
              keyboardType="number-pad"
              maxLength={6}
              onChangeText={setNewCode}
              placeholder="6 位验证码"
              placeholderTextColor={colors.textTertiary}
              style={styles.input}
              value={newCode}
            />
          </View>
          <SendCodeButton
            busy={change.sending === 'new'}
            disabled={!newPhoneValid}
            onPress={() => void change.sendNewCode(newPhone.trim())}
            sent={change.sentTo.next}
          />
        </View>

        {change.failure ? <Text style={styles.failure}>{change.failure}</Text> : null}

        <AppButton
          disabled={!ready}
          label={change.saving ? '正在换绑…' : '确认更换'}
          onPress={() => void submit()}
          style={styles.submit}
        />
      </ScrollView>
    </AppScreen>
  );
}

function SendCodeButton({
  busy,
  sent,
  disabled,
  onPress,
}: {
  busy: boolean;
  sent: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={sent ? '重新发送验证码' : '获取验证码'}
      accessibilityRole="button"
      disabled={busy || disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.sendButton, pressed && styles.pressed]}
    >
      <Text style={[styles.sendText, disabled && styles.sendTextDisabled]}>
        {busy ? '发送中…' : sent ? '重新发送' : '获取验证码'}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  loading: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  intro: {
    paddingTop: 4,
    color: colors.textSecondary,
    fontFamily,
    ...typography.body,
  },
  section: {
    marginTop: 22,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  grow: {
    flex: 1,
  },
  currentPhone: {
    flex: 1,
    color: colors.text,
    fontFamily,
    ...typography.body,
  },
  input: {
    minHeight: 48,
    marginTop: 10,
    paddingHorizontal: 14,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    color: colors.text,
    fontFamily,
    ...typography.input,
  },
  sendButton: {
    minHeight: 44,
    paddingHorizontal: 4,
    justifyContent: 'center',
  },
  sendText: {
    color: colors.primaryStrong,
    fontFamily,
    ...typography.meta,
    fontWeight: '600',
  },
  sendTextDisabled: {
    color: colors.textTertiary,
  },
  hint: {
    marginTop: 6,
    color: colors.danger,
    fontFamily,
    ...typography.meta,
  },
  failure: {
    marginTop: 16,
    color: colors.danger,
    fontFamily,
    ...typography.meta,
  },
  submit: {
    marginTop: 28,
  },
  pressed: {
    opacity: 0.6,
  },
});
