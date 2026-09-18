FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN cpBookedRadar-v2.2-Preload.txt /tmp/bookedradar-v22-preload.mjs && node /tmp/bookedradar-v22-preload.mjs && rm /tmp/bookedradar-v22-preload.mjs
ENV NODE_ENV=production
EXPOSE 5050
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD wget -qO- http://127.0.0.1:5050/health || exit 1
CMD ["node", "server.js"]
