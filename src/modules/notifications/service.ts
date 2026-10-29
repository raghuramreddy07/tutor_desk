import { withTenant } from "../../lib/tenantDb";
import type { NotificationListQuery } from "./schemas";

export const listNotifications = (
  centerId: string,
  query: NotificationListQuery,
) =>
  withTenant(centerId, async (transaction) => {
    const where = {
      centerId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.studentId ? { studentId: query.studentId } : {}),
    };
    const [notifications, total] = await Promise.all([
      transaction.notification.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        take: query.limit,
        skip: query.offset,
        select: {
          id: true,
          studentId: true,
          parentUserId: true,
          type: true,
          channel: true,
          status: true,
          payload: true,
          dedupeKey: true,
          createdAt: true,
          sentAt: true,
          error: true,
          skippedReason: true,
        },
      }),
      transaction.notification.count({ where }),
    ]);
    return { notifications, total, limit: query.limit, offset: query.offset };
  });
