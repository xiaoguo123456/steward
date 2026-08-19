/**
 * @steward/api-client
 *
 * 由 packages/contracts 的 OpenAPI 生成的 TypeScript Client。
 * 移动端只能通过这里访问网络：不得手写 DTO、URL、枚举或错误码。
 *
 * 生成产物位于 src/generated，运行 `pnpm client:generate` 重新生成，禁止手工修改。
 */

// 运行时配置与错误类型
export { configureApiClient, newIdempotencyKey } from './http/runtime';
export type { RuntimeConfig } from './http/runtime';
export { ApiError, isApiError, isUnauthenticated, errorMessage } from './http/error';
export type { ErrorCode } from './http/error';

// 生成的 DTO 类型
export * from './generated/model';

// 生成的请求方法与 TanStack Query Hooks
export * from './generated/auth/auth';
export * from './generated/users/users';
export * from './generated/lists/lists';
export * from './generated/tasks/tasks';
export * from './generated/events/events';
export * from './generated/projects/projects';
export * from './generated/notes/notes';
export * from './generated/trackers/trackers';
export * from './generated/views/views';
export * from './generated/captures/captures';
export * from './generated/media/media';
export * from './generated/assistant/assistant';
export * from './generated/memory/memory';
export * from './generated/system/system';
