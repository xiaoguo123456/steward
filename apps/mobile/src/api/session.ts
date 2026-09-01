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
  /** 串行化安全存储写入，避免旧账号的慢写在新账号写入后才完成。 */
  private persistence: Promise<void> = Promise.resolve();
  /** 每次恢复、登录或退出都会递增，用来丢弃旧账号迟到的 Refresh 响应。 */
  private generation = 0;

  /** 应用启动时恢复登录态。 */
  async restore(): Promise<boolean> {
    this.session = await loadSession();
    this.generation += 1;
    this.refreshing = null;
    return this.session !== null;
  }

  isLoggedIn(): boolean {
    return this.session !== null;
  }

  async accessToken(): Promise<string | null> {
    return this.session?.accessToken ?? null;
  }

  userId(): string | null {
    return this.session?.userId ?? null;
  }

  async signIn(tokens: TokenPair, userId?: string): Promise<void> {
    const resolvedUserId = userId ?? this.session?.userId;
    if (!resolvedUserId) throw new Error('保存登录态前必须确定用户 ID');
    this.session = {
      userId: resolvedUserId,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      accessExpiresAt: tokens.access_expires_at,
    };
    this.generation += 1;
    // 旧账号仍在途的 Refresh 不再属于当前会话，不能让新账号复用它。
    this.refreshing = null;
    const next = this.session;
    await this.persist(() => saveSession(next));
    this.emit();
  }

  async signOut(): Promise<void> {
    const wasLoggedIn = this.session !== null;
    this.session = null;
    this.generation += 1;
    this.refreshing = null;
    // 先同步切断内存会话并只通知一次。多个并发请求可能同时收到 401；
    // 如果每个请求都清缓存、重建登录路由，就会形成可见的页面闪烁。
    if (wasLoggedIn) {
      this.emit();
    }
    await this.persist(clearSession);
  }

  /**
   * 用 Refresh Token 续期。
   *
   * 并发请求可能同时收到 401，这里用一个进行中的 Promise 去重，
   * 避免同一个 Refresh Token 被并发轮换而互相作废。
   */
  async refresh(): Promise<boolean> {
    const source = this.session;
    if (!source) {
      return false;
    }
    if (this.refreshing) {
      return this.refreshing;
    }

    const sourceGeneration = this.generation;
    const request = this.refreshSession(source, sourceGeneration);
    this.refreshing = request;
    void request.finally(() => {
      if (this.refreshing === request) {
        this.refreshing = null;
      }
    });

    return request;
  }

  private async refreshSession(source: StoredSession, sourceGeneration: number): Promise<boolean> {
    try {
      const response = await refreshToken({ refresh_token: source.refreshToken });
      // 用户可能在请求期间退出或登录了另一个账号。迟到响应只能丢弃，
      // 绝不能把旧账号 Token 与新账号 userId 组合后写进安全存储。
      if (this.generation !== sourceGeneration || this.session !== source) {
        return false;
      }
      await this.signIn(response.data, source.userId);
      return true;
    } catch {
      if (this.generation !== sourceGeneration || this.session !== source) {
        return false;
      }
      // 刷新失败说明登录态确实失效了，清理后由 UI 跳回登录页。
      await this.signOut();
      return false;
    }
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private persist(operation: () => Promise<void>): Promise<void> {
    const result = this.persistence.then(operation, operation);
    // 后续写入不能因为前一次失败而永久停在 rejected 链上；调用者仍会收到本次错误。
    this.persistence = result.catch(() => undefined);
    return result;
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
