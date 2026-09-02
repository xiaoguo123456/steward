/** Access Token 到期前提前续期，避免刚恢复页面就先收到一次 401。 */
export const ACCESS_TOKEN_REFRESH_LEEWAY_MS = 60_000;

export function shouldRefreshAccessToken(
  expiresAt: string,
  now = Date.now(),
  leeway = ACCESS_TOKEN_REFRESH_LEEWAY_MS,
): boolean {
  const expiresAtMs = Date.parse(expiresAt);
  return !Number.isFinite(expiresAtMs) || expiresAtMs <= now + leeway;
}
