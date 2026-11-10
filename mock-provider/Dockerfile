FROM node:20-alpine

WORKDIR /app/mock-provider

COPY mock-provider/package.json ./
RUN npm install --omit=dev

COPY mock-provider/ .

EXPOSE 4000

CMD ["node", "server.js"]
