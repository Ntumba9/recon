FROM node:20-alpine

# Prisma's query/schema engines need OpenSSL to run on Alpine.
RUN apk add --no-cache openssl

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .
RUN npx prisma generate
RUN npm run build
RUN chmod +x scripts/docker-entrypoint.sh

# node:20-alpine already ships an unprivileged "node" user/group - run as
# that instead of root. Nothing here needs root: the app binds an
# unprivileged port (3000) and every file it touches at runtime (node_modules,
# .next, the Prisma-generated client) is already owned by this user once
# chown'd.
RUN chown -R node:node /app
USER node

EXPOSE 3000

CMD ["./scripts/docker-entrypoint.sh"]
