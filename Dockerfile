# Image unique : compile le frontend, compile le backend, sert le tout depuis Node (un seul processus).
# Build : docker build -t paper-trading .   (Render le fait automatiquement depuis render.yaml)

FROM node:22-alpine AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM node:22-alpine AS backend
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci
COPY backend/ ./
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=backend /app/backend/node_modules ./backend/node_modules
COPY --from=backend /app/backend/dist ./backend/dist
COPY --from=backend /app/backend/package.json ./backend/package.json
COPY --from=frontend /app/frontend/dist ./frontend/dist
COPY db ./db
WORKDIR /app/backend
# Ne tourne pas en root
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-8080}/healthz" || exit 1
CMD ["node", "dist/index.js"]
