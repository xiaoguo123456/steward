import { defineConfig } from 'orval';

// 两个 project 读取同一份 bundle：
// 一个生成 Fetch + TanStack Query Hooks，一个生成 Zod 运行时校验器。
// 生成结果全部位于 src/generated，禁止手工修改。
export default defineConfig({
  client: {
    input: '../contracts/dist/openapi.bundle.yaml',
    output: {
      mode: 'tags-split',
      target: './src/generated/endpoints.ts',
      schemas: './src/generated/model',
      client: 'react-query',
      httpClient: 'fetch',
      biome: false,
      prettier: false,
      override: {
        // 所有请求都经过同一个 mutator：它负责 baseURL、鉴权头、
        // 错误信封解包和 401 时的令牌刷新。
        mutator: {
          path: './src/http/fetcher.ts',
          name: 'stewardFetch',
        },
        fetch: {
          // mutator 直接返回响应体并在失败时抛出 ApiError，
          // 因此不需要 {data, status, headers} 包装层。
          includeHttpResponseReturnType: false,
        },
        query: {
          // 不要设置 useQuery/useMutation：它们的含义是「所有操作都生成这种 Hook」，
          // 设了任何一个都会让 GET 与 PATCH 生成成同一类。留空时 orval 按
          // HTTP 方法自动区分：GET → useQuery，其余 → useMutation。
          signal: true,
        },
      },
    },
  },
  zod: {
    input: '../contracts/dist/openapi.bundle.yaml',
    output: {
      mode: 'tags-split',
      target: './src/generated/zod.ts',
      client: 'zod',
      fileExtension: '.zod.ts',
      biome: false,
      prettier: false,
    },
  },
});
