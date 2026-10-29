import type { Plan, Prisma } from "@prisma/client";
import { PLAN_LIMITS, planResourceLabel, type PlanResource } from "../config/plans";
import { AppError } from "../middleware/errors";

type Usage = Record<PlanResource, number>;

export type CenterPlanUsage = {
  plan: Plan;
  limits: (typeof PLAN_LIMITS)[Plan];
  usage: Usage;
};

const activePendingTeacherInvite = (now: Date, excludedInviteId?: string) => ({
  role: "TEACHER" as const,
  acceptedAt: null,
  revokedAt: null,
  expiresAt: { gt: now },
  ...(excludedInviteId ? { id: { not: excludedInviteId } } : {}),
});

export const lockCenterForPlanChange = async (
  transaction: Prisma.TransactionClient,
  centerId: string,
): Promise<void> => {
  const rows = await transaction.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "Center"
    WHERE "id" = ${centerId}::uuid
    FOR UPDATE
  `;
  if (rows.length === 0) {
    throw new AppError(404, "NOT_FOUND", "Center not found");
  }
};

export const getCenterPlanUsage = async (
  transaction: Prisma.TransactionClient,
  centerId: string,
): Promise<CenterPlanUsage> => {
  const center = await transaction.center.findUnique({
    where: { id: centerId },
    select: { plan: true },
  });
  if (!center) {
    throw new AppError(404, "NOT_FOUND", "Center not found");
  }
  const now = new Date();
  const [students, teachers, pendingTeacherInvites, batches] = await Promise.all([
    transaction.student.count({ where: { centerId } }),
    transaction.membership.count({ where: { centerId, role: "TEACHER" } }),
    transaction.invite.count({
      where: { centerId, ...activePendingTeacherInvite(now) },
    }),
    transaction.batch.count({ where: { centerId } }),
  ]);
  return {
    plan: center.plan,
    limits: PLAN_LIMITS[center.plan],
    usage: {
      students,
      teachers: teachers + pendingTeacherInvites,
      batches,
    },
  };
};

export const assertWithinPlanLimit = async (
  transaction: Prisma.TransactionClient,
  centerId: string,
  resource: PlanResource,
  options: { additional?: number; excludedInviteId?: string } = {},
): Promise<void> => {
  await lockCenterForPlanChange(transaction, centerId);
  const center = await transaction.center.findUnique({
    where: { id: centerId },
    select: { plan: true },
  });
  if (!center) {
    throw new AppError(404, "NOT_FOUND", "Center not found");
  }
  const now = new Date();
  let currentUsage: number;
  if (resource === "students") {
    currentUsage = await transaction.student.count({ where: { centerId } });
  } else if (resource === "batches") {
    currentUsage = await transaction.batch.count({ where: { centerId } });
  } else {
    const [teachers, pending] = await Promise.all([
      transaction.membership.count({ where: { centerId, role: "TEACHER" } }),
      transaction.invite.count({
        where: {
          centerId,
          ...activePendingTeacherInvite(now, options.excludedInviteId),
        },
      }),
    ]);
    currentUsage = teachers + pending;
  }
  const limit = PLAN_LIMITS[center.plan][resource];
  const requested = currentUsage + (options.additional ?? 1);
  if (limit !== null && requested > limit) {
    const label = planResourceLabel[resource];
    throw new AppError(
      402,
      "PLAN_LIMIT_REACHED",
      `The ${center.plan} plan allows ${limit} ${label}s; current usage is ${currentUsage}`,
    );
  }
};

export const exceededPlanLimits = (
  usage: Usage,
  plan: Plan,
): Array<{ resource: PlanResource; used: number; limit: number }> => {
  const limits = PLAN_LIMITS[plan];
  return (Object.keys(usage) as PlanResource[])
    .filter((resource) => {
      const limit = limits[resource];
      return limit !== null && usage[resource] > limit;
    })
    .map((resource) => ({
      resource,
      used: usage[resource],
      limit: limits[resource] as number,
    }));
};
