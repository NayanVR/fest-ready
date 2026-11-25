FROM oven/bun:1-slim
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY src ./src
COPY playbooks ./playbooks
RUN mkdir -p /data && chown bun:bun /data
ENV PORT=4100 DB_PATH=/data/controller.db PLAYBOOK_DIR=/app/playbooks
USER bun
EXPOSE 4100
CMD ["bun", "start"]
