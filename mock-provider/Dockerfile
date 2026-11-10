FROM node:20-alpine

WORKDIR /app

# scenarios.js reads ../shared/fixtures relative to mock-provider/, so shared/
# must sit alongside mock-provider/ here just as it does in the repo.
COPY shared/ shared/

WORKDIR /app/mock-provider

COPY mock-provider/package.json ./
RUN npm install --omit=dev

COPY mock-provider/ .

EXPOSE 4000

CMD ["node", "server.js"]
