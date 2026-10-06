# Multi-stage image for api / worker / executor (select with the command).
FROM node:24-bookworm-slim AS deps
WORKDIR /app
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/executor/package.json apps/executor/
COPY apps/dashboard/package.json apps/dashboard/
COPY mcp/trading-control/package.json mcp/trading-control/
COPY extension/package.json extension/
COPY packages packages
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm --filter @ct/api --filter @ct/worker --filter @ct/executor build && pnpm --filter @ct/dashboard build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
USER node
CMD ["node", "apps/api/dist/index.js"]
