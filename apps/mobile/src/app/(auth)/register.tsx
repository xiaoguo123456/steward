import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/features/auth/components/auth-actions';
import { AuthInput, AuthShell } from '@/features/auth/components/auth-shell';
import { colors, fontFamily, radius } from '@/theme/tokens';

export default function RegisterScreen() {
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');

  return (
    <AuthShell compactLogo heading="创建账号" subtitle="注册清单，开始高效管理每一天">
      <AuthInput
        icon="phone-portrait-outline"
        keyboardType="phone-pad"
        onChangeText={setPhone}
        placeholder="请输入手机号"
        value={phone}
      />
      <AuthInput
        icon="card-outline"
        keyboardType="number-pad"
        onChangeText={setCode}
        placeholder="请输入验证码"
        trailing={
          <Pressable style={styles.codeButton}>
            <Text style={styles.codeText}>获取验证码</Text>
          </Pressable>
        }
        value={code}
      />
      <AuthInput
        icon="lock-closed-outline"
        onChangeText={setPassword}
        placeholder="设置密码（至少6位）"
        secureTextEntry
        value={password}
      />
      <View style={styles.buttonWrap}>
        <PrimaryButton onPress={() => router.replace('/today')}>注册</PrimaryButton>
      </View>
      <View style={styles.footer}>
        <Text style={styles.muted}>已有账号？</Text>
        <Pressable hitSlop={10} onPress={() => router.replace('/login')}>
          <Text style={styles.link}>立即登录</Text>
        </Pressable>
      </View>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  codeButton: {
    height: 34,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
  },
  codeText: {
    color: colors.primary,
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
  },
  buttonWrap: {
    marginTop: 1,
  },
  footer: {
    marginTop: 18,
    flexDirection: 'row',
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
    fontSize: 14,
    fontWeight: '600',
  },
});
