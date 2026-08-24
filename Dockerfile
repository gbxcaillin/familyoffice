# Build stage
FROM node:22-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# Runtime stage — only the standalone server and its traced dependencies
FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

RUN groupadd --system app && useradd --system --gid app app

COPY --from=builder --chown=app:app /app/.next/standalone ./
COPY --from=builder --chown=app:app /app/.next/static ./.next/static
COPY --from=builder --chown=app:app /app/public ./public

# SQLite database and uploaded documents live on mounted volumes
RUN mkdir -p /app/data /app/uploads && chown -R app:app /app/data /app/uploads

USER app
EXPOSE 3000
CMD ["node", "server.js"]
