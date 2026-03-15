import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient as PrismaClientClass } from "@/app/generated/prisma/client";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is not configured.");
}

const createPrismaClient = () =>
  new PrismaClientClass({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });

type PrismaClientInstance = ReturnType<typeof createPrismaClient>;

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClientInstance;
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
