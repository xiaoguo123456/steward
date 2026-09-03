import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';

export type CaptureAssistantSession = {
  captureId: string;
  operationId?: string;
  draft?: string;
  intent?: string;
  projectId?: string;
};

type CaptureAssistantSessionContextValue = {
  session: CaptureAssistantSession | null;
  clearSession: (captureId?: string) => void;
  openSession: (session: CaptureAssistantSession) => void;
};

const CaptureAssistantSessionContext = createContext<CaptureAssistantSessionContextValue | null>(null);

/**
 * 保存当前 App 会话里仍需用户处理的 Capture 引用。
 *
 * 服务端 Capture 仍是权威状态；这里只保存 ID 和展示摘要，使用户关闭 AI 浮层后
 * 能从常驻入口回到同一上下文。进程重启后的恢复继续由“最近输入”负责。
 */
export function CaptureAssistantSessionProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<CaptureAssistantSession | null>(null);

  const openSession = useCallback((next: CaptureAssistantSession) => {
    if (!next.captureId.trim()) return;
    setSession({ ...next, captureId: next.captureId.trim() });
  }, []);

  const clearSession = useCallback((captureId?: string) => {
    setSession((current) => {
      if (captureId && current?.captureId !== captureId) return current;
      return null;
    });
  }, []);

  const value = useMemo(
    () => ({ clearSession, openSession, session }),
    [clearSession, openSession, session],
  );

  return (
    <CaptureAssistantSessionContext.Provider value={value}>
      {children}
    </CaptureAssistantSessionContext.Provider>
  );
}

export function useCaptureAssistantSession(): CaptureAssistantSessionContextValue {
  const value = useContext(CaptureAssistantSessionContext);
  if (!value) {
    throw new Error('useCaptureAssistantSession 必须在 CaptureAssistantSessionProvider 内使用');
  }
  return value;
}
