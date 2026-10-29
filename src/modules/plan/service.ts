import { PLAN_LIMITS } from "../../config/plans";
import {
  exceededPlanLimits,
  getCenterPlanUsage,
  lockCenterForPlanChange,
} from "../../lib/planLimits";
import { withTenant } from "../../lib/tenantDb";
import { AppError } from "../../middleware/errors";

export const getPlan = (centerId: string) =>
  withTenant(centerId, (transaction) =>
    getCenterPlanUsage(transaction, centerId),
  );

export const updatePlan = (centerId: string, requestedPlan: "FREE" | "PRO") =>
  withTenant(centerId, async (transaction) => {
    await lockCenterForPlanChange(transaction, centerId);
    const current = await getCenterPlanUsage(transaction, centerId);
    const exceeded = exceededPlanLimits(current.usage, requestedPlan);
    if (exceeded.length > 0) {
      const details = exceeded
        .map(({ resource, used, limit }) => `${resource}: ${used}/${limit}`)
        .join(", ");
      throw new AppError(
        409,
        "PLAN_LIMIT_REACHED",
        `Cannot change to the ${requestedPlan} plan while usage exceeds its limits (${details}); existing data was not deleted`,
      );
    }

    await transaction.center.update({
      where: { id: centerId },
      data: { plan: requestedPlan },
    });
    return {
      plan: requestedPlan,
      limits: PLAN_LIMITS[requestedPlan],
      usage: current.usage,
    };
  });
