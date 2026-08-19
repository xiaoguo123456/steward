# @steward/api-client

由 `@steward/contracts` 的 OpenAPI 生成的 TypeScript Client。移动端只能通过它访问网络。

## 生成

```bash
pnpm --filter @steward/api-client run generate
```

产物位于 `src/generated`，禁止手工修改。两个 Orval project 读取同一份 bundle：
一个生成 Fetch + TanStack Query Hooks，一个生成 Zod 校验器。

## 手写部分

只有 `src/http` 三个文件：

- `fetcher.ts`：所有请求的唯一出口。拼接 baseURL、附加鉴权头、
  把错误信封翻译成 `ApiError`、在 401 时用 Refresh Token 静默续期并重放一次。
  它还负责补上 **Orval 不会生成的 `Idempotency-Key` 头**。
- `error.ts`：`ApiError` 与错误码判断辅助。错误码类型直接复用生成类型。
- `runtime.ts`：由宿主应用注入 baseURL 与令牌读取回调，本包不依赖任何平台 API。

## 使用

```ts
import { configureApiClient, useGetToday } from '@steward/api-client';

configureApiClient({
  baseUrl: 'http://localhost:8787',
  getAccessToken: async () => token,
  refreshTokens: async () => refresh(),
});

const today = useGetToday();
```

需要「用户重试也复用同一个幂等键」时显式传入：

```ts
createTask(body, { headers: { 'Idempotency-Key': stableKey } });
```
