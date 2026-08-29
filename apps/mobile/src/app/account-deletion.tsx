import {
  errorMessage,
  getAccountDeletionStatus,
  login,
  newIdempotencyKey,
  reauthenticateAccountDeletion,
  requestAccountDeletion,
  requestAccountDeletionCode,
  requestPhoneCode,
  type AccountDeletionStatusRecord,
} from '@steward/api-client';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { session } from '@/api/session';
import { deviceTimezone } from '@/api/timezone-sync';
import { AppButton } from '@/components/ui/app-button';
import { AppScreen } from '@/components/ui/app-screen';
import { NavHeader } from '@/components/ui/nav-header';
import { StatePanel } from '@/components/ui/state-panel';
import {
  clearPendingAccountDeletion,
  loadAccountDeletionCredential,
  loadPendingAccountDeletion,
  saveAccountDeletionCredential,
  savePendingAccountDeletion,
  type AccountDeletionCredential,
  type PendingAccountDeletion,
} from '@/features/account/account-deletion-storage';
import { deleteAccountCaptureDrafts } from '@/features/capture/capture-draft-store';
import { PHONE_PATTERN } from '@/features/auth/login-input';
import { colors, fontFamily, radius, typography } from '@/theme/tokens';

type Phase = 'loading' | 'login' | 'reauth' | 'status';

const statusLabels: Record<AccountDeletionStatusRecord['status'], string> = {
  accepted: '已受理',
  revoking_sessions: '正在撤销登录会话',
  purging_assets: '正在删除图片与录音',
  purging_derivatives: '正在删除派生数据',
  purging_primary: '正在删除在线主库数据',
  completed: '在线数据删除完成',
  failed: '需要人工核查',
};

export default function AccountDeletionScreen() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('loading');
  const [phone, setPhone] = useState('');
  const [loginCode, setLoginCode] = useState('');
  const [reauthCode, setReauthCode] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [credential, setCredential] = useState<AccountDeletionCredential | null>(null);
  const [pending, setPending] = useState<PendingAccountDeletion | null>(null);
  const [status, setStatus] = useState<AccountDeletionStatusRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const reauthKey = useRef(newIdempotencyKey());
  const deletionKey = useRef(newIdempotencyKey());

  useEffect(() => {
    let active = true;
    void Promise.all([
      loadAccountDeletionCredential(),
      loadPendingAccountDeletion(),
    ]).then(([saved, savedPending]) => {
      if (!active) return;
      if (saved) {
        setCredential(saved);
        setPhase('status');
      } else {
        setPending(savedPending);
        if (savedPending) {
          setAcknowledged(true);
          deletionKey.current = savedPending.deletionIdempotencyKey;
          setHint('上次请求可能已受理，可使用原幂等凭证继续查询受理结果。');
        }
        setPhase(session.isLoggedIn() ? 'reauth' : 'login');
      }
    });
    return () => { active = false; };
  }, []);

  useEffect(() => session.subscribe((loggedIn) => {
    setPhase((current) => current === 'status' ? current : (loggedIn ? 'reauth' : 'login'));
  }), []);

  const refreshStatus = useCallback(async (saved: AccountDeletionCredential | null) => {
    if (!saved) return;
    try {
      const response = await getAccountDeletionStatus(saved.requestId, {
        headers: { 'Deletion-Status-Token': saved.statusToken },
      });
      setStatus(response.data);
      setFailure(null);
    } catch (error) {
      setFailure(errorMessage(error, '删除进度暂时无法读取。'));
    }
  }, []);

  useEffect(() => {
    if (phase !== 'status' || !credential) return;
    const initial = setTimeout(() => void refreshStatus(credential), 0);
    const timer = setInterval(() => void refreshStatus(credential), 4_000);
    return () => { clearTimeout(initial); clearInterval(timer); };
  }, [credential, phase, refreshStatus]);

  const sendLoginCode = async () => {
    if (!PHONE_PATTERN.test(phone) || busy) return;
    setBusy(true); setFailure(null);
    try {
      const response = await requestPhoneCode({ phone });
      if (response.data.dev_code) setLoginCode(response.data.dev_code);
      setHint('验证码已发送。');
    } catch (error) {
      setFailure(errorMessage(error, '验证码发送失败。'));
    } finally { setBusy(false); }
  };

  const signInForDeletion = async () => {
    if (!PHONE_PATTERN.test(phone) || loginCode.length !== 6 || busy) return;
    setBusy(true); setFailure(null);
    try {
      const response = await login({ phone, code: loginCode, timezone: deviceTimezone() });
      await session.signIn(response.data.tokens, response.data.user.id);
      setPhase('reauth');
      setHint('已确认账号，请继续完成删除重新认证。');
    } catch (error) {
      setFailure(errorMessage(error, '账号验证失败。'));
    } finally { setBusy(false); }
  };

  const sendReauthCode = async () => {
    if (busy) return;
    setBusy(true); setFailure(null);
    try {
      const response = await requestAccountDeletionCode();
      if (response.data.dev_code) setReauthCode(response.data.dev_code);
      setHint('删除验证码已发送到当前绑定手机号。');
    } catch (error) {
      setFailure(errorMessage(error, '删除验证码发送失败。'));
    } finally { setBusy(false); }
  };

  const submitDeletion = async () => {
    if ((!pending && reauthCode.length !== 6) || !acknowledged || busy) return;
    setBusy(true); setFailure(null);
    try {
      let resumable = pending;
      if (!resumable) {
        const verified = await reauthenticateAccountDeletion(
          { code: reauthCode },
          { headers: { 'Idempotency-Key': reauthKey.current } },
        );
        resumable = {
          reauthToken: verified.data.reauth_token,
          deletionIdempotencyKey: deletionKey.current,
          expiresAt: verified.data.expires_at,
        };
        setPending(resumable);
        await savePendingAccountDeletion(resumable).catch(() => undefined);
      }
      const accepted = await requestAccountDeletion(
        { reauth_token: resumable.reauthToken, acknowledgement: true },
        { headers: { 'Idempotency-Key': resumable.deletionIdempotencyKey } },
      );
      const saved: AccountDeletionCredential = {
        requestId: accepted.data.deletion_request_id,
        statusToken: accepted.data.status_token,
        acceptedAt: accepted.data.accepted_at,
        backupExpiresAt: accepted.data.backup_expires_at,
      };
      // 服务端已受理后，本地清理失败不能把页面伪装回“未受理”。先进入独立状态页，
      // 再尽力保存凭证、清理当前账号草稿和移除会话。
      setCredential(saved);
      setPhase('status');
      setHint(null);
      const credentialSaved = await saveAccountDeletionCredential(saved).then(
        () => true,
        () => false,
      );
      if (credentialSaved) {
        setPending(null);
        await clearPendingAccountDeletion();
      } else {
        setHint('状态凭证未能写入设备安全存储，请立即复制本页凭证。');
      }
      const accountId = session.userId();
      if (accountId) await deleteAccountCaptureDrafts(accountId).catch(() => undefined);
      // 若状态凭证未成功落盘，保留只可用于严格重放的本地 Access Token，
      // 避免关闭页面后既丢失状态凭证又无法恢复首次受理结果。
      if (credentialSaved) await session.signOut().catch(() => undefined);
    } catch (error) {
      setFailure(errorMessage(error, '账号删除未能受理，请重新验证后再试。'));
    } finally { setBusy(false); }
  };

  if (phase === 'loading') {
    return <AppScreen><NavHeader title="账号与数据删除" /><StatePanel icon="time-outline" message="正在读取账号状态。" title="加载中" /></AppScreen>;
  }

  return (
    <AppScreen>
      <NavHeader title="账号与数据删除" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {phase === 'login' ? (
          <View style={styles.panel}>
            <Text accessibilityRole="header" style={styles.title}>先确认要删除的账号</Text>
            <Text style={styles.copy}>H5 不复用其他网站的登录态。手机号与验证码只交给正式 Auth API。</Text>
            <Field label="手机号" onChange={setPhone} value={phone} />
            <Field label="登录验证码" onChange={setLoginCode} value={loginCode} />
            <View style={styles.row}>
              <AppButton compact disabled={busy || !PHONE_PATTERN.test(phone)} label="获取验证码" onPress={() => void sendLoginCode()} variant="secondary" />
              <AppButton compact disabled={busy || loginCode.length !== 6} label="验证账号" onPress={() => void signInForDeletion()} />
            </View>
          </View>
        ) : phase === 'reauth' ? (
          <View style={styles.panel}>
            <Text accessibilityRole="header" style={styles.title}>删除前再次验证</Text>
            <Text style={styles.copy}>
              受理后所有登录会话会立即失效；在线主库、媒体和派生数据进入后台删除队列，且无法恢复。
            </Text>
            <View style={styles.scope}>
              <Text style={styles.scopeTitle}>将删除</Text>
              <Text style={styles.scopeItem}>任务、日程、项目、笔记、记录、Capture 与 AI 数据</Text>
              <Text style={styles.scopeItem}>上传的图片、录音及可删除派生内容</Text>
              <Text style={styles.scopeItem}>当前设备中属于该账号的草稿与离线上传队列</Text>
            </View>
            <Field label="删除验证码" onChange={setReauthCode} value={reauthCode} />
            <AppButton compact disabled={busy} label="获取删除验证码" onPress={() => void sendReauthCode()} variant="secondary" />
            <AppButton
              compact
              label={acknowledged ? '已确认删除影响' : '我已阅读并确认删除影响'}
              onPress={() => setAcknowledged((current) => !current)}
              variant={acknowledged ? 'secondary' : 'text'}
            />
            <AppButton
              disabled={busy || (!pending && reauthCode.length !== 6) || !acknowledged}
              label={busy ? '正在受理…' : pending ? '继续查询受理结果' : '永久删除账号与数据'}
              onPress={() => void submitDeletion()}
              variant="danger"
            />
          </View>
        ) : (
          <View style={styles.panel}>
            <Text accessibilityRole="header" style={styles.title}>删除进度</Text>
            {status ? (
              <>
                <Text style={styles.status}>{statusLabels[status.status]}</Text>
                <Text style={styles.copy}>请求编号：{status.deletion_request_id}</Text>
                <Text style={styles.copy}>在线状态更新：{formatDate(status.updated_at)}</Text>
                <Text style={styles.copy}>备份最晚自然过期：{formatDate(status.backup_expires_at)}</Text>
                {status.public_error ? <Text style={styles.failure}>{status.public_error}</Text> : null}
              </>
            ) : <Text style={styles.copy}>正在读取删除进度…</Text>}
            <AppButton compact label="刷新进度" onPress={() => void refreshStatus(credential)} variant="secondary" />
            {credential ? (
              <Text selectable style={styles.credential}>
                请保存本页与状态凭证，关闭浏览器后 H5 不会把凭证长期写入本地存储。{credential.statusToken}
              </Text>
            ) : null}
          </View>
        )}

        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
        {failure ? <Text accessibilityRole="alert" style={styles.failure}>{failure}</Text> : null}
      </ScrollView>
    </AppScreen>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        keyboardType="number-pad"
        maxLength={label === '手机号' ? 11 : 6}
        onChangeText={(value) => onChange(value.replace(/\D/g, ''))}
        placeholder={label}
        placeholderTextColor={colors.textTertiary}
        style={styles.input}
        value={value}
      />
    </View>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 48 },
  panel: { gap: 14, padding: 20, borderRadius: radius.lg, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border },
  title: { color: colors.text, fontFamily, ...typography.section },
  copy: { color: colors.textSecondary, fontFamily, ...typography.body },
  scope: { gap: 8, padding: 14, borderRadius: radius.md, backgroundColor: colors.primarySoft },
  scopeTitle: { color: colors.text, fontFamily, ...typography.label },
  scopeItem: { color: colors.textSecondary, fontFamily, ...typography.meta },
  field: { gap: 7 },
  label: { color: colors.textSecondary, fontFamily, ...typography.label },
  input: { minHeight: 48, paddingHorizontal: 14, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, color: colors.text, fontFamily, ...typography.body },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  status: { color: colors.primaryStrong, fontFamily, ...typography.detail },
  hint: { marginTop: 14, color: colors.primaryStrong, fontFamily, ...typography.meta },
  failure: { marginTop: 14, color: colors.danger, fontFamily, ...typography.meta },
  credential: { color: colors.textTertiary, fontFamily, ...typography.caption },
});
