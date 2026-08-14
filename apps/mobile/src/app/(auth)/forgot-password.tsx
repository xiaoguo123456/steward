import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppScreen } from '@/components/ui/app-screen';
import { AppIcon } from '@/components/ui/icon';
import { PrimaryButton } from '@/features/auth/components/auth-actions';
import { AuthInput } from '@/features/auth/components/auth-shell';
import { colors, fontFamily, radius } from '@/theme/tokens';

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');

  return (
    <AppScreen includeBottomInset>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.nav}>
          <Pressable hitSlop={12} onPress={() => router.back()} style={styles.back}>
            <AppIcon name="chevron-back" size={24} />
          </Pressable>
          <Text style={styles.title}>找回密码</Text>
          <View style={styles.back} />
        </View>
        <Text style={styles.subtitle}>输入手机号，通过验证码重置密码</Text>
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
          placeholder="设置新密码"
          secureTextEntry
          value={password}
        />
        <View style={styles.buttonWrap}>
          <PrimaryButton onPress={() => router.replace('/login')}>重置密码</PrimaryButton>
        </View>
      </ScrollView>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 10,
  },
  nav: {
    height: 64,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  back: {
    width: 42,
    height: 42,
    justifyContent: 'center',
  },
  title: {
    color: colors.text,
    fontFamily,
    fontSize: 17,
    fontWeight: '600',
  },
  subtitle: {
    marginTop: 14,
    marginBottom: 18,
    color: colors.textSecondary,
    fontFamily,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
  },
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
    marginTop: 2,
  },
});
