import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { PrismaClient as PrismaClientClass } from "@/app/generated/prisma/client";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is not configured.");
}

const createPgPool = () =>
  new Pool({
    connectionString: databaseUrl,
    // Keep connection usage conservative for session-mode poolers.
    max: process.env.NODE_ENV === "production" ? 5 : 1,
  });

const createPrismaClient = (pool: Pool) =>
  new PrismaClientClass({
    adapter: new PrismaPg(pool),
  });

type PrismaClientInstance = ReturnType<typeof createPrismaClient>;

const globalForPrisma = globalThis as unknown as {
  pgPool?: Pool;
  prisma?: PrismaClientInstance;
};

const pgPool = globalForPrisma.pgPool ?? createPgPool();
export const prisma = globalForPrisma.prisma ?? createPrismaClient(pgPool);

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.pgPool = pgPool;
  globalForPrisma.prisma = prisma;
}
