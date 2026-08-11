FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json server.js ./
RUN npm ci --omit=dev
ENV NODE_ENV=production
CMD ["node", "server.js"]
