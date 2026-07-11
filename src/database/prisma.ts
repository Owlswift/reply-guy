import { PrismaClient } from "@prisma/client";
import { PrismaSqlite } from "prisma-adapter-sqlite";
import "dotenv/config";

const adapter = new PrismaSqlite({
  url: process.env.DATABASE_URL || "file:./echo.db",
});

export const prisma = new PrismaClient({
  adapter,
});
