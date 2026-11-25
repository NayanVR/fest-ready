FROM oven/bun:1-slim
WORKDIR /app
COPY package.json ./
COPY src ./src
USER bun
CMD ["bun", "start"]
