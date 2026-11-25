# node:22.23.5-alpine3.23, pinned by digest
# No build step and no runtime dependencies: Node 22 runs the TypeScript directly (type stripping) and ships node:sqlite.
FROM node@sha256:6868d4695b947ee120bffaa463fecd68cde370d7bfec92955e7c8ac576b4f475
ENV NODE_ENV=production NODE_NO_WARNINGS=1
WORKDIR /app
COPY package.json ./
COPY src ./src
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8787
CMD ["node", "src/main.ts"]
