# Google Cloud Run — JOULEY discount code server
# Node 22 slim image keeps the container small and fast to start
FROM node:22-slim

WORKDIR /app

# Copy package files and install production dependencies only
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy source and build the server bundle
COPY . .
RUN npm run build

# Cloud Run injects PORT via environment variable (default 8080)
ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["node", "dist/index.js"]
