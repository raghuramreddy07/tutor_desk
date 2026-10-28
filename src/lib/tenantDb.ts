import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

export const withTenant = <T>(
  centerId: string,
  fn: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> =>
  prisma.$transaction(async (transaction) => {
    // true prevents tenant context from leaking when the pool reuses this connection.
    await transaction.$queryRaw`
      SELECT set_config('app.current_center', ${centerId}, true)
    `;
    return fn(transaction);
  });

export const withInviteToken = <T>(
  tokenHash: string,
  fn: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> =>
  prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      SELECT set_config('app.invite_token_hash', ${tokenHash}, true)
    `;
    return fn(transaction);
  });
