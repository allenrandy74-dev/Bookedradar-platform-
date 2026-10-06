# Pin the reviewed Node/Alpine release: PostgreSQL 18 is in Alpine 3.24 main.
FROM node:22.23.3-alpine3.24
# Keep the official client package and its runtime libraries in the final image.
# apk verifies repository signatures; do not use edge or untrusted packages.
RUN apk add --no-cache postgresql18-client=18.6-r0 libpq=18.6-r0 \
    && psql --version | grep -E '^psql \(PostgreSQL\) 18\.' \
    && pg_dump --version | grep -E '^pg_dump \(PostgreSQL\) 18\.' \
    && pg_restore --version | grep -E '^pg_restore \(PostgreSQL\) 18\.'
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
# Current repository source is authoritative. Do not replay historical preload
# scripts during production builds; they can overwrite newer tested modules.
RUN npm run check && npm test
ENV NODE_ENV=production
EXPOSE 5050
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD wget -qO- http://127.0.0.1:5050/health || exit 1
CMD ["node", "server.js"]
