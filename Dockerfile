# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
WORKDIR /app
COPY node/package.json node/package-lock.json ./
RUN npm ci
COPY node/tsconfig.json ./
COPY node/src ./src
RUN npx tsc

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY node/package.json node/package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
ENV PORT=8080
EXPOSE 8080
CMD ["node", "dist/src/server.js"]
