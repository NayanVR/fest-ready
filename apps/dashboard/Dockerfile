FROM oven/bun:1-slim
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build && chown -R bun:bun .next
USER bun
EXPOSE 3000
CMD ["bun", "run", "start"]
