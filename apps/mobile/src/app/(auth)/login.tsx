import { errorMessage, login, requestPhoneCode } from '@steward/api-client';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { session } from '@/api/session';
import { PrimaryButton } from '@/features/auth/components/auth-actions';
import { AuthInput, AuthShell } from '@/features/auth/components/auth-shell';
import { resolvePhoneCodeDelivery } from '@/features/auth/phone-code';
import { colors, fontFamily } from '@/theme/tokens';

const PHONE_PATTERN = /^1[3-9]\d{9}$/;

export default function LoginScreen() {
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const phoneRef = useRef('');

  useEffect(() => {
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  const startCooldown = (seconds: number) => {
    setCooldown(seconds);
    if (timer.current) clearInterval(timer.current);
    timer.current = setInterval(() => {
      setCooldown((current) => {
        if (current <= 1) {
          if (timer.current) clearInterval(timer.current);
          return 0;
        }
        return current - 1;
      });
    }, 1000);
  };

  const phoneValid = PHONE_PATTERN.test(phone);
  const canSubmit = phoneValid && code.length === 6 && !submitting;

  const handleSendCode = async () => {
    if (!phoneValid || sending || cooldown > 0) return;
    const requestedPhone = phone;
    setError(null);
    setSending(true);
    try {
      const response = await requestPhoneCode({ phone: requestedPhone });
      startCooldown(response.data.resend_after_seconds);
      // 请求期间若改了手机号，旧号码的验证码不能填进新号码表单。
      if (phoneRef.current !== requestedPhone) return;
      const delivery = resolvePhoneCodeDelivery(response.data);
      setCode(delivery.code);
      setHint(delivery.hint);
    } catch (err) {
      setError(errorMessage(err, '验证码发送失败，请稍后重试。'));
    } finally {
      setSending(false);
    }
  };

  const handleLogin = async () => {
    if (!canSubmit) return;
    setError(null);
    setSubmitting(true);
    try {
      const response = await login({
        phone,
        code,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      await session.signIn(response.data.tokens);
      router.replace('/today');
    } catch (err) {
      setError(errorMessage(err, '登录失败，请检查手机号与验证码。'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell heading="欢迎回来" subtitle="用手机号登录，继续高效的一天">
      <AuthInput
        icon="phone-portrait-outline"
        keyboardType="number-pad"
        maxLength={11}
        onChangeText={(value) => {
          const normalized = value.replace(/\D/g, '');
          phoneRef.current = normalized;
          setPhone(normalized);
          setCode('');
          setError(null);
          setHint(null);
        }}
        placeholder="请输入手机号"
        value={phone}
      />
      <View style={styles.codeRow}>
        <View style={styles.codeInput}>
          <AuthInput
            containerStyle={styles.codeInputShell}
            icon="keypad-outline"
            keyboardType="number-pad"
            maxLength={6}
            onChangeText={(value) => {
              setCode(value.replace(/\D/g, ''));
              setError(null);
            }}
            placeholder="6 位验证码"
            value={code}
          />
        </View>
        <Pressable
          accessibilityLabel="获取验证码"
          accessibilityRole="button"
          accessibilityState={{ disabled: !phoneValid || cooldown > 0 || sending }}
          disabled={!phoneValid || cooldown > 0 || sending}
          onPress={handleSendCode}
          style={({ pressed }) => [
            styles.codeButton,
            (!phoneValid || cooldown > 0) && styles.codeButtonDisabled,
            pressed && styles.codeButtonPressed,
          ]}
        >
          {sending ? (
            <ActivityIndicator color={colors.primaryStrong} size="small" />
          ) : (
            <Text style={styles.codeButtonText}>
              {cooldown > 0 ? `${cooldown}s` : '获取验证码'}
            </Text>
          )}
        </Pressable>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {!error && hint ? <Text style={styles.hint}>{hint}</Text> : null}

      <View style={styles.buttonWrap}>
        <PrimaryButton disabled={!canSubmit} onPress={handleLogin}>
          {submitting ? '登录中…' : '登录'}
        </PrimaryButton>
      </View>
      <Text style={styles.muted}>首次登录将自动创建账号</Text>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  codeRow: {
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  codeInput: {
    flex: 1,
  },
  codeInputShell: {
    marginBottom: 0,
  },
  codeButton: {
    minWidth: 96,
    height: 54,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    backgroundColor: colors.primarySoft,
  },
  codeButtonDisabled: {
    backgroundColor: colors.surface,
  },
  codeButtonPressed: {
    opacity: 0.7,
  },
  codeButtonText: {
    color: colors.primaryStrong,
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
  },
  buttonWrap: {
    marginTop: 18,
  },
  error: {
    marginTop: 12,
    color: colors.danger,
    fontFamily,
    fontSize: 13,
    lineHeight: 19,
  },
  hint: {
    marginTop: 12,
    color: colors.primaryStrong,
    fontFamily,
    fontSize: 13,
    lineHeight: 19,
  },
  muted: {
    marginTop: 16,
    color: colors.textSecondary,
    fontFamily,
    fontSize: 13,
    textAlign: 'center',
  },
});
