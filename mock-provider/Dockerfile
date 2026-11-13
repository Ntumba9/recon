FROM node:20-alpine

WORKDIR /app

# scenarios.js reads ../shared/fixtures relative to mock-provider/, so shared/
# must sit alongside mock-provider/ here just as it does in the repo.
COPY shared/ shared/

WORKDIR /app/mock-provider

COPY mock-provider/package.json ./
RUN npm install --omit=dev

COPY mock-provider/ .

# node:20-alpine already ships an unprivileged "node" user/group - run as
# that instead of root. Nothing here needs root: the mock provider binds
# an unprivileged port (4000) and has no other system-level requirement.
RUN chown -R node:node /app
USER node

EXPOSE 4000

CMD ["node", "server.js"]
