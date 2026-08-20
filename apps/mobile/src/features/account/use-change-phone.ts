import {
  changePhone,
  errorMessage,
  requestCurrentPhoneCode,
  requestPhoneCode,
} from '@steward/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

/**
 * 更换绑定手机号。
 *
 * 要两个验证码：当前号的和新号的。账号就是手机号（登录＝手机号＋验证码），
 * 只验新号的话，一个被别人拿到的会话就能把号码换走，机主再也登不进来。
 *
 * 换绑成功后其他设备上的登录会失效，当前设备不受影响。
 */
export function useChangePhone() {
  const queryClient = useQueryClient();
  const [sending, setSending] = useState<'current' | 'new' | null>(null);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<{ current: boolean; next: boolean }>({
    current: false,
    next: false,
  });

  /**
   * 给当前绑定的号码发验证码。
   *
   * 不传手机号：它是脱敏下发的（138****8000），客户端本来就没有完整号码，
   * 而服务端已经知道请求者是谁。
   */
  const sendCurrentCode = async () => {
    setSending('current');
    setFailure(null);
    try {
      await requestCurrentPhoneCode();
      setSentTo((s) => ({ ...s, current: true }));
      return true;
    } catch (error) {
      setFailure(errorMessage(error, '验证码没能发送。'));
      return false;
    } finally {
      setSending(null);
    }
  };

  const sendNewCode = async (newPhone: string) => {
    setSending('new');
    setFailure(null);
    try {
      await requestPhoneCode({ phone: newPhone, purpose: 'change_phone' });
      setSentTo((s) => ({ ...s, next: true }));
      return true;
    } catch (error) {
      setFailure(errorMessage(error, '验证码没能发送。'));
      return false;
    } finally {
      setSending(null);
    }
  };

  const submit = async (input: {
    currentCode: string;
    newPhone: string;
    newCode: string;
  }) => {
    setSaving(true);
    setFailure(null);
    try {
      await changePhone({
        current_code: input.currentCode,
        new_phone: input.newPhone,
        new_code: input.newCode,
      });
      // 手机号出现在账号页与设置页的多处，换完统一失效。
      await queryClient.invalidateQueries();
      return true;
    } catch (error) {
      setFailure(errorMessage(error, '换绑没能完成。'));
      return false;
    } finally {
      setSaving(false);
    }
  };

  return { sending, saving, failure, sentTo, sendCurrentCode, sendNewCode, submit };
}

/** 手机号格式。和服务端同一条规则，只是为了早一步告诉用户。 */
export function isPhone(value: string): boolean {
  return /^1[3-9]\d{9}$/.test(value.trim());
}
