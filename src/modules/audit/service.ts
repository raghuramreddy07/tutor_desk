import { withTenant } from "../../lib/tenantDb";
import type { AuditListQuery } from "./schemas";

export const listAuditLogs = (
  centerId: string,
  filters: AuditListQuery,
) =>
  withTenant(centerId, async (transaction) => {
    const endBefore = filters.to
      ? new Date(`${filters.to}T00:00:00.000Z`)
      : undefined;
    endBefore?.setUTCDate(endBefore.getUTCDate() + 1);
    const where = {
      centerId,
      ...(filters.action ? { action: filters.action } : {}),
      ...(filters.entityType ? { entityType: filters.entityType } : {}),
      ...(filters.entityId ? { entityId: filters.entityId } : {}),
      ...(filters.actorUserId ? { actorUserId: filters.actorUserId } : {}),
      ...(filters.from || filters.to
        ? {
            createdAt: {
              ...(filters.from
                ? { gte: new Date(`${filters.from}T00:00:00.000Z`) }
                : {}),
              ...(filters.to
                ? { lt: endBefore }
                : {}),
            },
          }
        : {}),
    };
    const [auditLogs, total] = await Promise.all([
      transaction.auditLog.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: filters.limit,
        skip: filters.offset,
      }),
      transaction.auditLog.count({ where }),
    ]);

    return { auditLogs, total, limit: filters.limit, offset: filters.offset };
  });
