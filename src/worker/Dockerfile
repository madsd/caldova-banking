FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
COPY src/web/package.json src/web/package.json
COPY src/worker/package.json src/worker/package.json
RUN npm ci
COPY src/worker ./src/worker
CMD ["npm", "run", "start", "--workspace", "@caldova/worker"]
