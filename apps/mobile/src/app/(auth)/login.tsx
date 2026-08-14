import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/features/auth/components/auth-actions';
import { AuthInput, AuthShell } from '@/features/auth/components/auth-shell';
import { colors, fontFamily } from '@/theme/tokens';

export default function LoginScreen() {
  const router = useRouter();
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');

  return (
    <AuthShell heading="欢迎回来" subtitle="登录你的清单，继续高效的一天">
      <AuthInput
        icon="person-outline"
        onChangeText={setAccount}
        placeholder="手机号或邮箱"
        value={account}
      />
      <AuthInput
        icon="lock-closed-outline"
        onChangeText={setPassword}
        placeholder="请输入密码"
        secureTextEntry
        value={password}
      />
      <Pressable
        hitSlop={10}
        onPress={() => router.push('/forgot-password')}
        style={styles.forgot}
      >
        <Text style={styles.link}>忘记密码？</Text>
      </Pressable>
      <View style={styles.buttonWrap}>
        <PrimaryButton onPress={() => router.replace('/today')}>登录</PrimaryButton>
      </View>
      <View style={styles.footer}>
        <Text style={styles.muted}>还没有账号？</Text>
        <Pressable hitSlop={10} onPress={() => router.push('/register')}>
          <Text style={styles.linkStrong}>立即注册</Text>
        </Pressable>
      </View>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  forgot: {
    alignSelf: 'flex-end',
    marginTop: -2,
  },
  buttonWrap: {
    marginTop: 18,
  },
  footer: {
    marginTop: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  muted: {
    color: colors.textSecondary,
    fontFamily,
    fontSize: 14,
  },
  link: {
    color: colors.primary,
    fontFamily,
    fontSize: 13,
    lineHeight: 20,
    fontWeight: '500',
  },
  linkStrong: {
    color: colors.primary,
    fontFamily,
    fontSize: 14,
    fontWeight: '600',
  },
});
