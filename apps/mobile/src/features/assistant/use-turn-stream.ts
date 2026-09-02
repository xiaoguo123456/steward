import { getStreamTurnUrl, type TurnStreamEvent } from '@steward/api-client';
import { useEffect, useRef, useState } from 'react';

import { resolveApiBaseUrl } from '@/api/config';
import { session } from '@/api/session';

/**
 * 订阅一次 Turn 的实时进度。
 *
 * React Native 没有内置 EventSource，而且 EventSource 也带不上 Authorization
 * 头。这里用 XHR 的增量 responseText 自己解 SSE —— 这是 RN 与浏览器上
 * 都能工作的做法，不需要额外依赖。
 *
 * 流只是让文字早点出现，不是权威内容：连不上、中途断开或事件丢失都不影响
 * 正确性，调用方在 done 之后照常去读消息列表。
 */
type StreamState = {
  /** 这份状态属于哪一轮。换轮次时靠它派生出空值，而不是在 effect 里重置。 */
  forTurn: string;
  text: string;
  label: string;
  finished: boolean;
  /** 传输层截断过这条快照：屏幕上的文字还不是全部。 */
  truncated: boolean;
};

const emptyState: StreamState = {
  forTurn: '',
  text: '',
  label: '',
  finished: false,
  truncated: false,
};

export function useTurnStream(turnId: string) {
  const [state, setState] = useState<StreamState>(emptyState);
  const requestRef = useRef<XMLHttpRequest | null>(null);

  useEffect(() => {
    if (!turnId) return;

    let cancelled = false;
    let offset = 0;

    const update = (patch: Partial<StreamState>) => {
      setState((current) => ({
        ...(current.forTurn === turnId ? current : emptyState),
        ...patch,
        forTurn: turnId,
      }));
    };

    const handleEvent = (event: TurnStreamEvent) => {
      switch (event.kind) {
        case 'delta':
          // text 是到目前为止的全文，直接替换。
          update({ text: event.text ?? '', truncated: event.truncated ?? false });
          break;
        case 'status':
        case 'tool':
          update({ label: event.text ?? '' });
          break;
        case 'done':
        case 'error':
          update({ finished: true });
          break;
        default:
          break;
      }
    };

    const drain = () => {
      if (cancelled) return;
      const request = requestRef.current;
      if (!request) return;
      const chunk = request.responseText.slice(offset);
      offset = request.responseText.length;
      // SSE 帧之间用空行分隔；最后一段可能还没收完整，留到下次。
      const frames = chunk.split('\n\n');
      const trailing = frames.pop();
      if (trailing) offset -= trailing.length;

      for (const frame of frames) {
        for (const line of frame.split('\n')) {
          if (!line.startsWith('data:')) continue;
          try {
            handleEvent(JSON.parse(line.slice(5).trim()) as TurnStreamEvent);
          } catch {
            // 半截帧或心跳注释，忽略即可。
          }
        }
      }
    };

    const start = async (allowRefresh: boolean) => {
      const token = await session.accessToken();
      if (cancelled || !token) return;
      const request = new XMLHttpRequest();
      requestRef.current = request;
      offset = 0;
      request.open('GET', `${resolveApiBaseUrl()}${getStreamTurnUrl(turnId)}`);
      request.setRequestHeader('Authorization', `Bearer ${token}`);
      request.onprogress = drain;
      request.onload = async () => {
        if (request.status === 401 && allowRefresh) {
          try {
            if (await session.refresh()) {
              if (!cancelled) void start(false);
              return;
            }
          } catch {
            // 临时续期失败时由现有轮询接管，不能因此清除长期登录态。
          }
        }
        drain();
        update({ finished: true });
      };
      // 连不上就安静退场，调用方的轮询会接管。
      request.onerror = () => update({ finished: true });
      request.send();
    };

    void start(true);

    return () => {
      cancelled = true;
      requestRef.current?.abort();
      requestRef.current = null;
    };
  }, [turnId]);

  // 换轮次时上一轮的内容立刻消失，不需要在 effect 里重置状态。
  return state.forTurn === turnId ? state : emptyState;
}
