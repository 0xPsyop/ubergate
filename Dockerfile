# Multi-stage Dockerfile for ubergate
# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json tsconfig.json ./
COPY scripts/ ./scripts/
RUN npm ci

COPY src/ ./src/
COPY examples/ ./examples/
RUN npm run build

# Stage 2: Production runtime
FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY config/ ./config/

# Ensure logs directory exists and is writable
RUN mkdir -p logs && chown -R node:node /app

USER node

EXPOSE 3000

CMD ["node", "dist/index.js"]
