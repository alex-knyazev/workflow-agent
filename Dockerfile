FROM node:20-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json eslint.config.mjs ./
COPY src ./src
COPY public ./public
COPY logs ./logs
COPY scripts ./scripts

RUN npm run build


FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3210

COPY package*.json ./
RUN apk add --no-cache su-exec \
	&& npm ci --omit=dev \
	&& npm cache clean --force

COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
COPY --from=build /app/logs ./logs
COPY scripts/docker-entrypoint.sh ./scripts/docker-entrypoint.sh

RUN chown -R node:node /app

EXPOSE 3210

ENTRYPOINT ["/app/scripts/docker-entrypoint.sh"]
CMD ["node", "dist/main.js"]