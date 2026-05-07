FROM oven/bun:1-slim AS base
WORKDIR /app

# Install dependencies
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Bust cache when source changes (pass --build-arg CACHEBUST=$(date +%s))
ARG CACHEBUST=1

# Copy source
COPY src/       ./src/
COPY server/    ./server/

EXPOSE 3000

ENV PORT=3000

CMD ["bun", "run", "server/index.ts"]
