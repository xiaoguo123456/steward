import { configureApiClient, refreshToken, type TokenPair } from '@steward/api-client';

import { resolveApiBaseUrl } from './config';
import { clearSession, loadSession, saveSession, type StoredSession } from './token-storage';

type Listener = (loggedIn: boolean) => void;

/**
 * 会话状态。
 *
 * 它是登录态的唯一来源：Client 通过回调读取令牌，
 * UI 通过订阅感知登录状态变化，两者不各自持有一份副本。
 */
class SessionStore {
  private session: StoredSession | null = null;
  private listeners = new Set<Listener>();
  private refreshing: Promise<boolean> | null = null;

  /** 应用启动时恢复登录态。 */
  async restore(): Promise<boolean> {
    this.session = await loadSession();
    return this.session !== null;
  }

  isLoggedIn(): boolean {
    return this.session !== null;
  }

  async accessToken(): Promise<string | null> {
    return this.session?.accessToken ?? null;
  }

  async signIn(tokens: TokenPair): Promise<void> {
    this.session = {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      accessExpiresAt: tokens.access_expires_at,
    };
    await saveSession(this.session);
    this.emit();
  }

  async signOut(): Promise<void> {
    const wasLoggedIn = this.session !== null;
    this.session = null;
    // 先同步切断内存会话并只通知一次。多个并发请求可能同时收到 401；
    // 如果每个请求都清缓存、重建登录路由，就会形成可见的页面闪烁。
    if (wasLoggedIn) {
      this.emit();
    }
    await clearSession();
  }

  /**
   * 用 Refresh Token 续期。
   *
   * 并发请求可能同时收到 401，这里用一个进行中的 Promise 去重，
   * 避免同一个 Refresh Token 被并发轮换而互相作废。
   */
  async refresh(): Promise<boolean> {
    if (!this.session) {
      return false;
    }
    if (this.refreshing) {
      return this.refreshing;
    }

    this.refreshing = (async () => {
      try {
        const response = await refreshToken({ refresh_token: this.session!.refreshToken });
        await this.signIn(response.data);
        return true;
      } catch {
        // 刷新失败说明登录态确实失效了，清理后由 UI 跳回登录页。
        await this.signOut();
        return false;
      } finally {
        this.refreshing = null;
      }
    })();

    return this.refreshing;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    const loggedIn = this.isLoggedIn();
    for (const listener of this.listeners) {
      listener(loggedIn);
    }
  }
}

export const session = new SessionStore();

/** 在应用启动时初始化 Client。 */
export function initApiClient(): void {
  configureApiClient({
    baseUrl: resolveApiBaseUrl(),
    getAccessToken: () => session.accessToken(),
    refreshTokens: () => session.refresh(),
  });
}
