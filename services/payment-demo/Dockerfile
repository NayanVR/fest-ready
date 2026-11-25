FROM oven/bun:1-slim
WORKDIR /app
COPY package.json ./
COPY src/server.ts ./src/server.ts
USER bun
EXPOSE 4300
HEALTHCHECK --interval=5s --timeout=2s --start-period=5s CMD ["bun", "-e", "const r = await fetch('http://127.0.0.1:' + (process.env.PORT ?? 4300) + '/healthz'); if (!r.ok || !(await r.json()).ok) process.exit(1)"]
CMD ["bun", "start"]
