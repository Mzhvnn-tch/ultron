# Production Multi-Stage Dockerfile for Ultron Research Engine
FROM node:20-slim AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --only=production && npx playwright install-deps chromium && npx playwright install chromium

COPY --from=builder /app/dist ./dist
COPY data ./data

EXPOSE 3002
CMD ["node", "dist/index.js"]
