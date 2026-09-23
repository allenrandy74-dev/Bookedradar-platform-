FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN cp src/integrations/tenant-adapters.js /tmp/tenant-adapters.current.js \
    && cp src/integrations/resend-email.js /tmp/resend-email.current.js \
    && cp test/tenant-adapters.test.js /tmp/tenant-adapters.test.current.js \
    && cp BookedRadar-v2.2-Preload.txt /tmp/bookedradar-v22-preload.mjs \
    && node /tmp/bookedradar-v22-preload.mjs \
    && cp /tmp/tenant-adapters.current.js src/integrations/tenant-adapters.js \
    && cp /tmp/resend-email.current.js src/integrations/resend-email.js \
    && cp /tmp/tenant-adapters.test.current.js test/tenant-adapters.test.js \
    && rm /tmp/bookedradar-v22-preload.mjs \
    && npm run check \
    && npm test
ENV NODE_ENV=production
EXPOSE 5050
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD wget -qO- http://127.0.0.1:5050/health || exit 1
CMD ["node", "server.js"]
