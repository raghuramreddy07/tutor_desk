import type { Role } from "@prisma/client";
import { requireAccessibleBatch } from "../../lib/batchAccess";
import { withTenant } from "../../lib/tenantDb";
import { AppError } from "../../middleware/errors";
import type { UpsertAttendanceInput } from "./schemas";

type AttendanceActor = {
  centerId: string;
  userId: string;
  role: Role;
};

const attendanceDate = (date: string): Date =>
  new Date(`${date}T00:00:00.000Z`);

const assertNotFuture = (date: string): void => {
  if (date > new Date().toISOString().slice(0, 10)) {
    throw new AppError(400, "VALIDATION_ERROR", "Attendance date cannot be in the future");
  }
};

export const markAttendance = (
  actor: AttendanceActor,
  batchId: string,
  input: UpsertAttendanceInput,
) =>
  withTenant(actor.centerId, async (transaction) => {
    await requireAccessibleBatch(
      transaction,
      actor.centerId,
      batchId,
      actor.userId,
      actor.role,
    );
    assertNotFuture(input.date);

    await transaction.$queryRaw`
      SELECT "id" FROM "Batch"
      WHERE "id" = ${batchId}::uuid AND "centerId" = ${actor.centerId}::uuid
      FOR SHARE
    `;

    const requestedIds = [...new Set(input.records.map(({ studentId }) => studentId))];
    const enrollments = await transaction.batchStudent.findMany({
      where: {
        centerId: actor.centerId,
        batchId,
        studentId: { in: requestedIds },
      },
      select: { studentId: true },
    });
    const enrolledIds = new Set(enrollments.map(({ studentId }) => studentId));
    const invalidIds = requestedIds.filter((studentId) => !enrolledIds.has(studentId));
    if (invalidIds.length > 0) {
      throw new AppError(
        422,
        "NOT_ENROLLED",
        `These students are not enrolled in this batch: ${invalidIds.join(", ")}`,
      );
    }

    const date = attendanceDate(input.date);
    for (const record of input.records) {
      await transaction.attendance.upsert({
        where: {
          batchId_studentId_date: {
            batchId,
            studentId: record.studentId,
            date,
          },
          centerId: actor.centerId,
        },
        create: {
          centerId: actor.centerId,
          batchId,
          studentId: record.studentId,
          date,
          status: record.status,
          markedByUserId: actor.userId,
        },
        update: {
          status: record.status,
          markedByUserId: actor.userId,
        },
      });
    }

    return transaction.attendance.findMany({
      where: { centerId: actor.centerId, batchId, date },
      orderBy: { studentId: "asc" },
    });
  });

export const getBatchAttendance = (
  actor: AttendanceActor,
  batchId: string,
  dateString: string,
) =>
  withTenant(actor.centerId, async (transaction) => {
    await requireAccessibleBatch(
      transaction,
      actor.centerId,
      batchId,
      actor.userId,
      actor.role,
    );
    const date = attendanceDate(dateString);
    const roster = await transaction.batchStudent.findMany({
      where: { centerId: actor.centerId, batchId },
      orderBy: [{ enrolledAt: "asc" }, { studentId: "asc" }],
      include: {
        student: {
          select: { id: true, name: true, grade: true, phone: true },
        },
        attendance: {
          where: { centerId: actor.centerId, batchId, date },
          select: { status: true },
        },
      },
    });
    return roster.map(({ student, attendance }) => ({
      student,
      status: attendance[0]?.status ?? null,
    }));
  });

export const getStudentAttendance = (
  actor: AttendanceActor,
  studentId: string,
  range: { from: string; to: string },
) =>
  withTenant(actor.centerId, async (transaction) => {
    const student = await transaction.student.findFirst({
      where: { id: studentId, centerId: actor.centerId },
      select: { id: true },
    });
    if (!student) {
      throw new AppError(404, "NOT_FOUND", "Student not found");
    }

    const assignedBatches =
      actor.role === "TEACHER"
        ? await transaction.batchTeacher.findMany({
            where: { centerId: actor.centerId, userId: actor.userId },
            select: { batchId: true },
          })
        : undefined;
    const records = await transaction.attendance.findMany({
      where: {
        centerId: actor.centerId,
        studentId,
        date: {
          gte: attendanceDate(range.from),
          lte: attendanceDate(range.to),
        },
        ...(assignedBatches
          ? { batchId: { in: assignedBatches.map(({ batchId }) => batchId) } }
          : {}),
      },
      orderBy: [{ date: "asc" }, { batchId: "asc" }],
      include: {
        enrollment: {
          select: { batch: { select: { id: true, name: true } } },
        },
      },
    });
    return records;
  });
