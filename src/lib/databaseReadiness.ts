import { prisma } from "./prisma";
import { redis } from "./redis";

export type ReadinessChecks = {
  database: boolean;
  redis: boolean;
};

export const checkReadiness = async (): Promise<ReadinessChecks> => {
  const [database, redisReady] = await Promise.all([
    prisma.$queryRaw`SELECT 1`.then(
      () => true,
      () => false,
    ),
    redis.ping().then(
      (response) => response === "PONG",
      () => false,
    ),
  ]);
  return { database, redis: redisReady };
};
