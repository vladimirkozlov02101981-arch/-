FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY server.js index.html ./
COPY js ./js
COPY css ./css
COPY assets ./assets
ENV PORT=3000
EXPOSE 3000
USER node
CMD ["node", "server.js"]
