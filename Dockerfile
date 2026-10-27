FROM node:22.11.0-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends tzdata ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production TZ=Europe/Vilnius PORT=3000 DATA_DIR=/data SECRETS_DIR=/run/secrets
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
COPY public ./public

# No secrets are baked in: credentials come from /run/secrets at runtime (see compose.yaml).
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
CMD ["node", "src/server.mjs"]
