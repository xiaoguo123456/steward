FROM node:22-alpine AS builder

RUN corepack enable && corepack prepare pnpm@10.32.1 --activate
WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/mobile/package.json apps/mobile/package.json
COPY packages/api-client/package.json packages/api-client/package.json
RUN pnpm install --frozen-lockfile --filter mobile...

COPY apps/mobile apps/mobile
COPY packages/api-client packages/api-client
ARG STEWARD_H5_RELEASE_MODE=staging
RUN node apps/mobile/scripts/check-public-h5.mjs --mode="$STEWARD_H5_RELEASE_MODE"
RUN pnpm --filter mobile run export:web

FROM node:22-alpine

WORKDIR /app
COPY --chown=node:node --from=builder /workspace/apps/mobile/dist ./dist
COPY --chown=node:node apps/mobile/scripts/serve-preview.mjs ./serve-preview.mjs

USER node
EXPOSE 4174
CMD ["node", "serve-preview.mjs", "--host", "0.0.0.0", "--port", "4174", "--dir", "dist"]
