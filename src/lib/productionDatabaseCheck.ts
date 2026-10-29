import { env } from "../config/env";
import { assertNonSuperuserConnection } from "../config/production";
import { prisma } from "./prisma";

export const verifyProductionDatabaseRole = async (): Promise<void> => {
  if (env.NODE_ENV !== "production") {
    return;
  }

  await assertNonSuperuserConnection(async () => {
    const [role] = await prisma.$queryRaw<
      Array<{ isSuperuser: boolean; ownsTables: boolean }>
    >`
      SELECT
        current_setting('is_superuser') = 'on' AS "isSuperuser",
        EXISTS (
          SELECT 1
          FROM pg_class
          WHERE relkind IN ('r', 'p')
            AND relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)
        ) AS "ownsTables"
    `;
    return role ?? { isSuperuser: false, ownsTables: false };
  });
};
