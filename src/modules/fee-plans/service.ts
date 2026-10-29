import { Prisma } from "@prisma/client";
import { withTenant } from "../../lib/tenantDb";
import { parsePaise, paiseToJson } from "../../lib/money";
import { AppError } from "../../middleware/errors";
import type { CreateFeePlanInput, UpdateFeePlanInput } from "./schemas";
import { recordAudit } from "../../lib/audit";

const planSelect = {
  id: true,
  centerId: true,
  batchId: true,
  name: true,
  amountPaise: true,
  frequency: true,
  dueDay: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

const serializePlan = <T extends { amountPaise: bigint }>(plan: T) => ({
  ...plan,
  amountPaise: paiseToJson(plan.amountPaise),
});

export const createFeePlan = (centerId: string, input: CreateFeePlanInput) =>
  withTenant(centerId, async (transaction) => {
    const batch = await transaction.batch.findFirst({
      where: { id: input.batchId, centerId },
      select: { id: true },
    });
    if (!batch) {
      throw new AppError(404, "NOT_FOUND", "Batch not found");
    }

    const plan = await transaction.feePlan.create({
      data: {
        centerId,
        batchId: input.batchId,
        name: input.name,
        amountPaise: parsePaise(input.amountPaise),
        frequency: input.frequency,
        dueDay: input.frequency === "MONTHLY" ? input.dueDay ?? null : null,
      },
      select: planSelect,
    });
    await recordAudit(transaction, {
      centerId,
      action: "fee_plan.created",
      entityType: "FeePlan",
      entityId: plan.id,
      metadata: { changedFields: ["name", "amountPaise", "frequency", "dueDay"] },
    });
    return serializePlan(plan);
  });

export const listFeePlans = (
  centerId: string,
  filters: { batchId?: string; limit: number; offset: number },
) =>
  withTenant(centerId, async (transaction) => {
    const where = {
      centerId,
      ...(filters.batchId ? { batchId: filters.batchId } : {}),
    };
    const [plans, total] = await Promise.all([
      transaction.feePlan.findMany({
        where,
        select: planSelect,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        take: filters.limit,
        skip: filters.offset,
      }),
      transaction.feePlan.count({ where }),
    ]);
    return {
      plans: plans.map(serializePlan),
      total,
      limit: filters.limit,
      offset: filters.offset,
    };
  });

export const getFeePlan = (centerId: string, id: string) =>
  withTenant(centerId, async (transaction) => {
    const plan = await transaction.feePlan.findFirst({
      where: { id, centerId },
      select: planSelect,
    });
    if (!plan) {
      throw new AppError(404, "NOT_FOUND", "Fee plan not found");
    }
    return serializePlan(plan);
  });

export const updateFeePlan = (
  centerId: string,
  id: string,
  input: UpdateFeePlanInput,
) =>
  withTenant(centerId, async (transaction) => {
    const locked = await transaction.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "FeePlan"
      WHERE "id" = ${id}::uuid AND "centerId" = ${centerId}::uuid
      FOR UPDATE
    `;
    if (locked.length === 0) {
      throw new AppError(404, "NOT_FOUND", "Fee plan not found");
    }
    const existing = await transaction.feePlan.findFirstOrThrow({
      where: { id, centerId },
      select: {
        frequency: true,
        name: true,
        amountPaise: true,
        dueDay: true,
        isActive: true,
      },
    });
    if (
      input.dueDay !== undefined &&
      (existing.frequency !== "MONTHLY" || input.dueDay === null)
    ) {
      throw new AppError(
        400,
        "VALIDATION_ERROR",
        "A monthly fee plan requires dueDay from 1 to 28",
      );
    }
    const result = await transaction.feePlan.updateMany({
      where: { id, centerId },
      data: {
        ...input,
        amountPaise:
          input.amountPaise === undefined ? undefined : parsePaise(input.amountPaise),
      },
    });
    if (result.count === 0) {
      throw new AppError(404, "NOT_FOUND", "Fee plan not found");
    }
    const plan = await transaction.feePlan.findFirstOrThrow({
      where: { id, centerId },
      select: planSelect,
    });
    await recordAudit(transaction, {
      centerId,
      action: "fee_plan.changed",
      entityType: "FeePlan",
      entityId: id,
      metadata: { changedFields: Object.keys(input) },
    });
    return serializePlan(plan);
  });

export const deleteFeePlan = (centerId: string, id: string) =>
  withTenant(centerId, async (transaction) => {
    const locked = await transaction.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "FeePlan"
      WHERE "id" = ${id}::uuid AND "centerId" = ${centerId}::uuid
      FOR UPDATE
    `;
    if (locked.length === 0) {
      throw new AppError(404, "NOT_FOUND", "Fee plan not found");
    }
    const assignmentCount = await transaction.studentFee.count({
      where: { centerId, feePlanId: id },
    });
    if (assignmentCount > 0) {
      throw new AppError(
        409,
        "FEE_PLAN_ASSIGNED",
        "This fee plan has student assignments; deactivate it instead",
      );
    }
    try {
      await transaction.feePlan.deleteMany({ where: { id, centerId } });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2003"
      ) {
        throw new AppError(
          409,
          "FEE_PLAN_ASSIGNED",
          "This fee plan has student assignments; deactivate it instead",
        );
      }
      throw error;
    }
    await recordAudit(transaction, {
      centerId,
      action: "fee_plan.deleted",
      entityType: "FeePlan",
      entityId: id,
    });
  });
