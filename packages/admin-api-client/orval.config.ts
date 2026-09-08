import { defineConfig } from 'orval';

/**
 * 由 Admin OpenAPI 生成 Client 与 TanStack Query Hooks。
 *
 * 和用户端的 api-client 完全分开：两边的鉴权模型不同（Cookie vs Bearer），
 * 错误码也不同。共用一个 fetcher 只会让「这个请求走哪套鉴权」变得含糊。
 */
export default defineConfig({
  client: {
    input: '../contracts/dist/admin.bundle.yaml',
    output: {
      mode: 'tags-split',
      target: './src/generated',
      schemas: './src/generated/model',
      client: 'react-query',
      // 留空：orval 按 HTTP 方法自动区分 useQuery 与 useMutation。
      // 设了任何一个都会让 GET 与 POST 生成成同一类。
      override: {
        mutator: { path: './src/http/fetcher.ts', name: 'adminFetch' },
      },
    },
  },
  zod: {
    input: '../contracts/dist/admin.bundle.yaml',
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
