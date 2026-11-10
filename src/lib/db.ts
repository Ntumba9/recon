import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __reconPrisma: PrismaClient | undefined;
}

export const prisma: PrismaClient = globalThis.__reconPrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__reconPrisma = prisma;
}
