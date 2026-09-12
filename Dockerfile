FROM node:22-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY sql ./sql
COPY test ./test
COPY public ./public
COPY compose.yaml Dockerfile ./
RUN mkdir -p /app/results
CMD ["node", "src/server.mjs"]
