import type { Prisma, Role } from "@prisma/client";
import { AppError } from "../middleware/errors";

export const accessibleBatchWhere = (
  centerId: string,
  userId: string,
  role: Role,
) => ({
  centerId,
  ...(role === "TEACHER"
    ? { teachers: { some: { centerId, userId } } }
    : {}),
});

export const requireAccessibleBatch = async (
  transaction: Prisma.TransactionClient,
  centerId: string,
  batchId: string,
  userId: string,
  role: Role,
) => {
  const batch = await transaction.batch.findFirst({
    where: { id: batchId, ...accessibleBatchWhere(centerId, userId, role) },
  });

  if (!batch) {
    throw new AppError(404, "NOT_FOUND", "Batch not found");
  }
  return batch;
};
