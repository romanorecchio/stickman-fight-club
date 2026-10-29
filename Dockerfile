FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY packages ./packages
COPY scripts ./scripts
RUN npm ci && npm run build && npm prune --omit=dev
ENV NODE_ENV=production
ENV PORT=4318
ENV STATIC_DIR=packages/client/dist
EXPOSE 4318
CMD ["node", "packages/server/dist/index.js"]
