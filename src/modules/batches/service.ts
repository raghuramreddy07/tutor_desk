import type { Role } from "@prisma/client";
import { accessibleBatchWhere, requireAccessibleBatch } from "../../lib/batchAccess";
import { withTenant } from "../../lib/tenantDb";
import { AppError } from "../../middleware/errors";
import type {
  CreateBatchInput,
  EnrollStudentsInput,
  SetBatchTeachersInput,
  UpdateBatchInput,
} from "./schemas";

export type BatchActor = {
  centerId: string;
  userId: string;
  role: Role;
};

const invalidAssignments = (userIds: string[]): AppError =>
  new AppError(
    422,
    "INVALID_TEACHERS",
    `These users are not OWNER or TEACHER members of this center: ${userIds.join(", ")}`,
  );

const invalidStudents = (studentIds: string[]): AppError =>
  new AppError(
    422,
    "INVALID_STUDENTS",
    `These students do not belong to this center: ${studentIds.join(", ")}`,
  );

export const createBatch = (centerId: string, input: CreateBatchInput) =>
  withTenant(centerId, (transaction) =>
    transaction.batch.create({ data: { ...input, centerId } }),
  );

export const listBatches = (
  actor: BatchActor,
  { limit, offset }: { limit: number; offset: number },
) =>
  withTenant(actor.centerId, async (transaction) => {
    const where = accessibleBatchWhere(actor.centerId, actor.userId, actor.role);
    const [batches, total] = await Promise.all([
      transaction.batch.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        take: limit,
        skip: offset,
      }),
      transaction.batch.count({ where }),
    ]);
    return { batches, total, limit, offset };
  });

export const getBatch = (actor: BatchActor, batchId: string) =>
  withTenant(actor.centerId, (transaction) =>
    requireAccessibleBatch(
      transaction,
      actor.centerId,
      batchId,
      actor.userId,
      actor.role,
    ),
  );

export const updateBatch = (
  actor: BatchActor,
  batchId: string,
  input: UpdateBatchInput,
) =>
  withTenant(actor.centerId, async (transaction) => {
    await requireAccessibleBatch(
      transaction,
      actor.centerId,
      batchId,
      actor.userId,
      actor.role,
    );
    if (actor.role !== "OWNER") {
      throw new AppError(403, "FORBIDDEN", "Only owners can update batches");
    }
    const result = await transaction.batch.updateMany({
      where: { id: batchId, centerId: actor.centerId },
      data: input,
    });
    if (result.count === 0) {
      throw new AppError(404, "NOT_FOUND", "Batch not found");
    }
    return transaction.batch.findFirstOrThrow({
      where: { id: batchId, centerId: actor.centerId },
    });
  });

export const deleteBatch = (centerId: string, batchId: string) =>
  withTenant(centerId, async (transaction) => {
    await transaction.$queryRaw`
      SELECT "id" FROM "Batch"
      WHERE "id" = ${batchId}::uuid AND "centerId" = ${centerId}::uuid
      FOR UPDATE
    `;
    const batch = await transaction.batch.findFirst({
      where: { id: batchId, centerId },
      select: { id: true },
    });
    if (!batch) {
      throw new AppError(404, "NOT_FOUND", "Batch not found");
    }

    const [attendanceCount, examCount] = await Promise.all([
      transaction.attendance.count({ where: { batchId, centerId } }),
      transaction.exam.count({ where: { batchId, centerId } }),
    ]);
    if (attendanceCount > 0 || examCount > 0) {
      throw new AppError(
        409,
        "BATCH_HAS_ACADEMIC_HISTORY",
        "A batch with attendance or exams cannot be deleted",
      );
    }

    const lockedPlans = await transaction.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "FeePlan"
      WHERE "centerId" = ${centerId}::uuid AND "batchId" = ${batchId}::uuid
      FOR UPDATE
    `;
    if (lockedPlans.length > 0) {
      const assignmentCount = await transaction.studentFee.count({
        where: { centerId, feePlanId: { in: lockedPlans.map(({ id }) => id) } },
      });
      if (assignmentCount > 0) {
        throw new AppError(
          409,
          "BATCH_HAS_FEE_ASSIGNMENTS",
          "A batch with assigned fee plans cannot be deleted",
        );
      }
      await transaction.feePlan.deleteMany({
        where: { centerId, id: { in: lockedPlans.map(({ id }) => id) } },
      });
    }
    await transaction.batch.deleteMany({ where: { id: batchId, centerId } });
  });

export const setBatchTeachers = async (
  centerId: string,
  batchId: string,
  input: SetBatchTeachersInput,
) =>
  withTenant(centerId, async (transaction) => {
    const batch = await transaction.batch.findFirst({
      where: { id: batchId, centerId },
      select: { id: true },
    });
    if (!batch) {
      throw new AppError(404, "NOT_FOUND", "Batch not found");
    }

    const validMemberships = await transaction.membership.findMany({
      where: {
        centerId,
        userId: { in: input.userIds },
        role: { in: ["OWNER", "TEACHER"] },
      },
      select: { userId: true },
    });
    const validIds = new Set(validMemberships.map(({ userId }) => userId));
    const invalidIds = input.userIds.filter((userId) => !validIds.has(userId));
    if (invalidIds.length > 0) {
      throw invalidAssignments(invalidIds);
    }

    await transaction.batchTeacher.deleteMany({ where: { centerId, batchId } });
    if (input.userIds.length > 0) {
      await transaction.batchTeacher.createMany({
        data: input.userIds.map((userId) => ({ centerId, batchId, userId })),
      });
    }

    return transaction.batchTeacher.findMany({
      where: { centerId, batchId },
      orderBy: { createdAt: "asc" },
      select: {
        userId: true,
        membership: {
          select: { role: true, user: { select: { name: true, email: true } } },
        },
      },
    });
  });

export const listBatchTeachers = (actor: BatchActor, batchId: string) =>
  withTenant(actor.centerId, async (transaction) => {
    await requireAccessibleBatch(
      transaction,
      actor.centerId,
      batchId,
      actor.userId,
      actor.role,
    );
    return transaction.batchTeacher.findMany({
      where: { centerId: actor.centerId, batchId },
      orderBy: { createdAt: "asc" },
      select: {
        userId: true,
        membership: {
          select: { role: true, user: { select: { name: true, email: true } } },
        },
      },
    });
  });

export const enrollStudents = (
  actor: BatchActor,
  batchId: string,
  input: EnrollStudentsInput,
) =>
  withTenant(actor.centerId, async (transaction) => {
    await requireAccessibleBatch(
      transaction,
      actor.centerId,
      batchId,
      actor.userId,
      actor.role,
    );
    const students = await transaction.student.findMany({
      where: { centerId: actor.centerId, id: { in: input.studentIds } },
      select: { id: true },
    });
    const validIds = new Set(students.map(({ id }) => id));
    const invalidIds = [...new Set(input.studentIds.filter((id) => !validIds.has(id)))];
    if (invalidIds.length > 0) {
      throw invalidStudents(invalidIds);
    }

    if (input.studentIds.length > 0) {
      await transaction.batchStudent.createMany({
        data: [...new Set(input.studentIds)].map((studentId) => ({
          centerId: actor.centerId,
          batchId,
          studentId,
        })),
        skipDuplicates: true,
      });
    }
    return transaction.batchStudent.findMany({
      where: { centerId: actor.centerId, batchId },
      orderBy: { enrolledAt: "asc" },
      include: { student: { select: { id: true, name: true, grade: true, phone: true } } },
    });
  });

export const listBatchStudents = (actor: BatchActor, batchId: string) =>
  withTenant(actor.centerId, async (transaction) => {
    await requireAccessibleBatch(
      transaction,
      actor.centerId,
      batchId,
      actor.userId,
      actor.role,
    );
    return transaction.batchStudent.findMany({
      where: { centerId: actor.centerId, batchId },
      orderBy: { enrolledAt: "asc" },
      include: { student: { select: { id: true, name: true, grade: true, phone: true } } },
    });
  });

export const unenrollStudent = (
  actor: BatchActor,
  batchId: string,
  studentId: string,
) =>
  withTenant(actor.centerId, async (transaction) => {
    await requireAccessibleBatch(
      transaction,
      actor.centerId,
      batchId,
      actor.userId,
      actor.role,
    );
    await transaction.$queryRaw`
      SELECT "id" FROM "Batch"
      WHERE "id" = ${batchId}::uuid AND "centerId" = ${actor.centerId}::uuid
      FOR UPDATE
    `;
    const attendanceCount = await transaction.attendance.count({
      where: { centerId: actor.centerId, batchId, studentId },
    });
    if (attendanceCount > 0) {
      throw new AppError(
        409,
        "ENROLLMENT_HAS_ATTENDANCE",
        "A student with attendance history cannot be unenrolled",
      );
    }
    const result = await transaction.batchStudent.deleteMany({
      where: { centerId: actor.centerId, batchId, studentId },
    });
    if (result.count === 0) {
      throw new AppError(404, "NOT_FOUND", "Enrollment not found");
    }
  });
