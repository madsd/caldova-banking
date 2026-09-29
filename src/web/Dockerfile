FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY src/web/package.json src/web/package.json
COPY src/worker/package.json src/worker/package.json
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build --workspace @caldova/web

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
WORKDIR /app
COPY --from=build /app/src/web/.next/standalone ./
COPY --from=build /app/src/web/.next/static ./src/web/.next/static
COPY --from=build /app/src/web/public ./src/web/public
WORKDIR /app/src/web
EXPOSE 3000
CMD ["node", "server.js"]
