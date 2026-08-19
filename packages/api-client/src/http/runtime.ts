/**
 * Client 运行时配置。
 *
 * 令牌的实际存储由宿主应用提供（原生用 SecureStore，Web 预览用内存），
 * 这个包本身不引入任何平台依赖，因此可以在 App、脚本和测试中复用。
 */
export type RuntimeConfig = {
  /** API 基地址，例如 http://localhost:8787。 */
  baseUrl: string;
  /** 返回当前 Access Token；未登录时返回 null。 */
  getAccessToken: () => Promise<string | null>;
  /** 用 Refresh Token 续期。成功返回 true，调用方会重放原请求。 */
  refreshTokens: () => Promise<boolean>;
};

const notConfigured = (): never => {
  throw new Error('@steward/api-client 尚未初始化，请在应用启动时调用 configureApiClient。');
};

let current: RuntimeConfig = {
  baseUrl: '',
  getAccessToken: notConfigured,
  refreshTokens: notConfigured,
};

/** 在应用启动时注入运行时配置。 */
export function configureApiClient(config: RuntimeConfig): void {
  current = config;
}

/** 供内部 fetcher 使用。 */
export function getRuntimeConfig(): RuntimeConfig {
  if (!current.baseUrl) {
    throw new Error('@steward/api-client 缺少 baseUrl，请检查 configureApiClient 的调用。');
  }
  return current;
}

/**
 * 生成客户端可复用的幂等键。
 *
 * 契约要求所有写请求携带 Idempotency-Key，并且重试时保持不变：
 * 因此调用方应当在发起操作时生成一次，重试时复用同一个值。
 */
export function newIdempotencyKey(): string {
  const random = Math.random().toString(36).slice(2, 12);
  return `idem_${Date.now().toString(36)}_${random}`;
}
