import { login, requestPhoneCode } from '@steward/api-client';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { session } from '@/api/session';
import { deviceTimezone } from '@/api/timezone-sync';
import { PrimaryButton } from '@/features/auth/components/auth-actions';
import { AuthInput, AuthShell } from '@/features/auth/components/auth-shell';
import {
  normalizePhoneInput,
  phoneValidationMessage,
  PHONE_PATTERN,
} from '@/features/auth/login-input';
import {
  loginErrorMessage,
  phoneCodeErrorMessage,
  resolvePhoneCodeDelivery,
} from '@/features/auth/phone-code';
import { openPublicPage } from '@/features/legal/open-public-page';
import { publicPagePaths } from '@/features/legal/public-pages';
import { colors, fontFamily, typography } from '@/theme/tokens';

export default function LoginScreen() {
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [codeRequested, setCodeRequested] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [legalError, setLegalError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [phoneTouched, setPhoneTouched] = useState(false);
  const [agreementAccepted, setAgreementAccepted] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const mounted = useRef(true);
  const phoneRef = useRef('');
  const codeInputRef = useRef<TextInput>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  const clearCooldown = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    setCooldown(0);
  };

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
  const phoneError = phoneValidationMessage(phone, phoneTouched);
  const canRequestCode = agreementAccepted && phoneValid && cooldown === 0 && !sending && !submitting;
  const canSubmit = agreementAccepted && phoneValid && code.length === 6 && !sending && !submitting;
  const primaryDisabled = codeRequested ? !canSubmit : !canRequestCode;

  const openLegalPage = async (path: typeof publicPagePaths.privacy | typeof publicPagePaths.terms) => {
    try {
      await openPublicPage(path);
    } catch {
      if (mounted.current) {
        setLegalError('暂时无法打开协议页面，请稍后重试。');
      }
    }
  };

  const handleSendCode = async () => {
    setPhoneTouched(true);
    if (!canRequestCode) return;
    const requestedPhone = phone;
    setRequestError(null);
    setLoginError(null);
    setSending(true);
    try {
      const response = await requestPhoneCode({ phone: requestedPhone });
      // 请求期间若改了手机号，旧号码的验证码不能填进新号码表单。
      if (!mounted.current || phoneRef.current !== requestedPhone) return;
      startCooldown(response.data.resend_after_seconds);
      const delivery = resolvePhoneCodeDelivery(response.data);
      setCode(delivery.code);
      setHint(delivery.hint);
      setCodeRequested(true);
      if (!delivery.code) codeInputRef.current?.focus();
    } catch (err) {
      if (mounted.current && phoneRef.current === requestedPhone) {
        setRequestError(phoneCodeErrorMessage(err));
      }
    } finally {
      if (mounted.current) setSending(false);
    }
  };

  const handleLogin = async () => {
    if (!canSubmit) return;
    setLoginError(null);
    setSubmitting(true);
    let signedIn = false;
    try {
      const response = await login({
        phone,
        code,
        timezone: deviceTimezone(),
      });
      await session.signIn(response.data.tokens, response.data.user.id);
      signedIn = true;
      router.replace('/today');
    } catch (err) {
      if (mounted.current) {
        setLoginError(loginErrorMessage(err));
        codeInputRef.current?.focus();
      }
    } finally {
      if (!signedIn && mounted.current) setSubmitting(false);
    }
  };

  return (
    <AuthShell heading="欢迎回来" subtitle="手机号验证后即可继续">
      <AuthInput
        accessibilityLabel="手机号"
        autoComplete="tel"
        editable={!submitting}
        icon="phone-portrait-outline"
        importantForAutofill="yes"
        keyboardType="number-pad"
        maxLength={11}
        onBlur={() => setPhoneTouched(true)}
        onChangeText={(value) => {
          const normalized = normalizePhoneInput(value);
          const phoneChanged = normalized !== phoneRef.current;
          phoneRef.current = normalized;
          setPhone(normalized);
          setCode('');
          setRequestError(null);
          setLoginError(null);
          setLegalError(null);
          setHint(null);
          if (phoneChanged && codeRequested) {
            setCodeRequested(false);
            clearCooldown();
          }
        }}
        placeholder="请输入手机号"
        textContentType="telephoneNumber"
        value={phone}
      />
      {phoneError ? (
        <Text accessibilityLiveRegion="polite" style={styles.fieldError}>
          {phoneError}
        </Text>
      ) : null}

      {codeRequested ? (
        <>
          <View style={styles.codeRow}>
            <View style={styles.codeInput}>
              <AuthInput
                accessibilityLabel="短信验证码"
                autoComplete={Platform.OS === 'android' ? 'sms-otp' : 'one-time-code'}
                containerStyle={styles.codeInputShell}
                editable={!submitting}
                icon="keypad-outline"
                importantForAutofill="yes"
                inputRef={codeInputRef}
                keyboardType="number-pad"
                maxLength={6}
                onChangeText={(value) => {
                  setCode(value.replace(/\D/g, ''));
                  setLoginError(null);
                }}
                placeholder="6 位验证码"
                textContentType="oneTimeCode"
                value={code}
              />
            </View>
            <Pressable
              accessibilityLabel={
                cooldown > 0 ? `${cooldown} 秒后可重新获取验证码` : '重新获取验证码'
              }
              accessibilityRole="button"
              accessibilityState={{ busy: sending, disabled: !canRequestCode }}
              disabled={!canRequestCode}
              onPress={handleSendCode}
              style={({ pressed }) => [
                styles.codeButton,
                !canRequestCode && styles.codeButtonDisabled,
                pressed && styles.codeButtonPressed,
              ]}
            >
              {sending ? (
                <ActivityIndicator color={colors.primaryStrong} size="small" />
              ) : (
                <Text
                  style={[
                    styles.codeButtonText,
                    !canRequestCode && styles.codeButtonTextDisabled,
                  ]}
                >
                  {cooldown > 0 ? `${cooldown}s` : '重新获取'}
                </Text>
              )}
            </Pressable>
          </View>
          {requestError ? (
            <Text accessibilityLiveRegion="assertive" accessibilityRole="alert" style={styles.error}>
              {requestError}
            </Text>
          ) : null}
          {!requestError && hint ? (
            <Text accessibilityLiveRegion="polite" style={styles.hint}>
              {hint}
            </Text>
          ) : null}
        </>
      ) : null}

      <View style={[styles.agreementRow, codeRequested && styles.agreementAfterCode]}>
        <Pressable
          accessibilityLabel={agreementAccepted ? '取消同意用户协议与隐私政策' : '同意用户协议与隐私政策'}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: agreementAccepted }}
          hitSlop={6}
          onPress={() => {
            setAgreementAccepted((current) => !current);
            setLegalError(null);
            setRequestError(null);
            setLoginError(null);
          }}
          style={({ pressed }) => [
            styles.checkbox,
            agreementAccepted && styles.checkboxChecked,
            pressed && styles.checkboxPressed,
          ]}
        >
          {agreementAccepted ? <Text style={styles.checkboxMark}>✓</Text> : null}
        </Pressable>
        <Text style={styles.agreementText}>
          我已阅读并同意
          <Text
            accessibilityRole="link"
            onPress={() => void openLegalPage(publicPagePaths.terms)}
            style={styles.agreementLink}
          >
            《用户协议》
          </Text>
          和
          <Text
            accessibilityRole="link"
            onPress={() => void openLegalPage(publicPagePaths.privacy)}
            style={styles.agreementLink}
          >
            《隐私政策》
          </Text>
        </Text>
      </View>
      {legalError ? (
        <Text accessibilityLiveRegion="assertive" accessibilityRole="alert" style={styles.legalError}>
          {legalError}
        </Text>
      ) : null}

      <View style={styles.buttonWrap}>
        <PrimaryButton
          accessibilityHint={!agreementAccepted ? '请先阅读并同意用户协议与隐私政策' : undefined}
          disabled={primaryDisabled}
          loading={codeRequested ? submitting : sending}
          onPress={codeRequested ? handleLogin : handleSendCode}
        >
          {codeRequested ? '登录' : '获取验证码'}
        </PrimaryButton>
      </View>

      {!codeRequested && requestError ? (
        <Text accessibilityLiveRegion="assertive" accessibilityRole="alert" style={styles.error}>
          {requestError}
        </Text>
      ) : null}
      {loginError ? (
        <Text accessibilityLiveRegion="assertive" accessibilityRole="alert" style={styles.error}>
          {loginError}
        </Text>
      ) : null}

      <Text style={styles.muted}>首次登录将自动创建账号</Text>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  agreementRow: {
    marginBottom: 6,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  agreementAfterCode: {
    marginTop: 14,
  },
  checkbox: {
    width: 24,
    height: 24,
    marginRight: 9,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  checkboxChecked: {
    borderColor: colors.primaryStrong,
    backgroundColor: colors.primaryStrong,
  },
  checkboxPressed: {
    opacity: 0.68,
  },
  checkboxMark: {
    color: colors.background,
    fontFamily,
    fontSize: 15,
    lineHeight: 18,
    fontWeight: '800',
  },
  agreementText: {
    minWidth: 0,
    flex: 1,
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
    lineHeight: 22,
  },
  agreementLink: {
    color: colors.primaryStrong,
    fontWeight: '600',
  },
  legalError: {
    marginTop: 4,
    marginLeft: 33,
    color: colors.danger,
    fontFamily,
    ...typography.meta,
  },
  codeRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
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
    minHeight: 54,
    paddingHorizontal: 12,
    paddingVertical: 10,
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
  codeButtonTextDisabled: {
    color: colors.textTertiary,
  },
  buttonWrap: {
    marginTop: 14,
  },
  error: {
    marginTop: 12,
    color: colors.danger,
    fontFamily,
    ...typography.meta,
  },
  hint: {
    marginTop: 12,
    color: colors.primaryStrong,
    fontFamily,
    ...typography.meta,
  },
  fieldError: {
    marginTop: -8,
    marginBottom: 14,
    color: colors.danger,
    fontFamily,
    ...typography.meta,
  },
  muted: {
    marginTop: 16,
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
    textAlign: 'center',
  },
});
