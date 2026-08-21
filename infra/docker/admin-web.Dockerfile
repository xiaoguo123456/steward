FROM node:22-alpine AS builder

RUN corepack enable && corepack prepare pnpm@10.32.1 --activate
WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/admin/package.json apps/admin/package.json
COPY packages/admin-api-client/package.json packages/admin-api-client/package.json
RUN pnpm install --frozen-lockfile --filter @steward/admin...

COPY apps/admin apps/admin
COPY packages/admin-api-client packages/admin-api-client
RUN pnpm --filter @steward/admin run build

FROM nginx:1.27-alpine

COPY infra/docker/admin-nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /workspace/apps/admin/dist /usr/share/nginx/html

EXPOSE 80
