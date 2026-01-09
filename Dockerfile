FROM node:20-alpine

WORKDIR /app

# Install bash and git (required by Claude Agent SDK)
RUN apk add --no-cache bash git curl

# Copy package files first for better layer caching
COPY container/package*.json ./

# Install dependencies (cached unless package files change)
RUN npm install

# Copy source code and configuration
COPY container/ ./

# Build TypeScript
RUN npm run build

# Change ownership and switch to non-root user (required for bypassPermissions mode)
RUN chown -R node:node /app
USER node

# Set SHELL environment variable to bash for Claude Agent SDK
ENV SHELL=/bin/bash

EXPOSE 8081

CMD ["node", "dist/server.js"]
