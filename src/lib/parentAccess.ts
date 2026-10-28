import type { Prisma } from "@prisma/client";
import { AppError } from "../middleware/errors";

export const listLinkedStudentIds = async (
  transaction: Prisma.TransactionClient,
  centerId: string,
  userId: string,
): Promise<string[]> => {
  const links = await transaction.parentStudent.findMany({
    where: { centerId, userId },
    select: { studentId: true },
    orderBy: { studentId: "asc" },
  });
  return links.map(({ studentId }) => studentId);
};

export const assertParentOfStudent = async (
  transaction: Prisma.TransactionClient,
  centerId: string,
  userId: string,
  studentId: string,
): Promise<void> => {
  const link = await transaction.parentStudent.findFirst({
    where: { centerId, userId, studentId },
    select: { id: true },
  });
  if (!link) {
    throw new AppError(404, "NOT_FOUND", "Student not found");
  }
};
