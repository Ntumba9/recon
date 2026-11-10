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

EXPOSE 3000

CMD ["./scripts/docker-entrypoint.sh"]
