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
    // Supabase session pooler: each serverless function should use max 1 connection
    max: 1,
    idleTimeoutMillis: 0, // Don't keep idle connections in serverless
    connectionTimeoutMillis: 10000,
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
