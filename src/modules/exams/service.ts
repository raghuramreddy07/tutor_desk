import type { Role } from "@prisma/client";
import { requireAccessibleBatch } from "../../lib/batchAccess";
import { withTenant } from "../../lib/tenantDb";
import { AppError } from "../../middleware/errors";
import type {
  CreateExamInput,
  UpdateExamInput,
  UpsertExamResultsInput,
} from "./schemas";

type ExamActor = {
  centerId: string;
  userId: string;
  role: Role;
};

const examDate = (date: string): Date =>
  new Date(`${date}T00:00:00.000Z`);

const requireAccessibleExam = async (
  transaction: Parameters<Parameters<typeof withTenant>[1]>[0],
  actor: ExamActor,
  examId: string,
) => {
  const exam = await transaction.exam.findFirst({
    where: { id: examId, centerId: actor.centerId },
  });
  if (!exam) {
    throw new AppError(404, "NOT_FOUND", "Exam not found");
  }
  await requireAccessibleBatch(
    transaction,
    actor.centerId,
    exam.batchId,
    actor.userId,
    actor.role,
  );
  return exam;
};

const lockBatch = async (
  transaction: Parameters<Parameters<typeof withTenant>[1]>[0],
  centerId: string,
  batchId: string,
) => {
  await transaction.$queryRaw`
    SELECT "id" FROM "Batch"
    WHERE "id" = ${batchId}::uuid AND "centerId" = ${centerId}::uuid
    FOR SHARE
  `;
};

const lockExam = async (
  transaction: Parameters<Parameters<typeof withTenant>[1]>[0],
  centerId: string,
  examId: string,
) => {
  await transaction.$queryRaw`
    SELECT "id" FROM "Exam"
    WHERE "id" = ${examId}::uuid AND "centerId" = ${centerId}::uuid
    FOR UPDATE
  `;
};

export const createExam = (
  actor: ExamActor,
  batchId: string,
  input: CreateExamInput,
) =>
  withTenant(actor.centerId, async (transaction) => {
    await requireAccessibleBatch(
      transaction,
      actor.centerId,
      batchId,
      actor.userId,
      actor.role,
    );
    await lockBatch(transaction, actor.centerId, batchId);
    return transaction.exam.create({
      data: {
        centerId: actor.centerId,
        batchId,
        name: input.name,
        maxMarks: input.maxMarks,
        date: examDate(input.date),
      },
    });
  });

export const listBatchExams = (actor: ExamActor, batchId: string) =>
  withTenant(actor.centerId, async (transaction) => {
    await requireAccessibleBatch(
      transaction,
      actor.centerId,
      batchId,
      actor.userId,
      actor.role,
    );
    return transaction.exam.findMany({
      where: { centerId: actor.centerId, batchId },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    });
  });

export const getExam = (actor: ExamActor, examId: string) =>
  withTenant(actor.centerId, async (transaction) => ({
    exam: await requireAccessibleExam(transaction, actor, examId),
  }));

export const updateExam = (
  actor: ExamActor,
  examId: string,
  input: UpdateExamInput,
) =>
  withTenant(actor.centerId, async (transaction) => {
    await lockExam(transaction, actor.centerId, examId);
    const exam = await requireAccessibleExam(transaction, actor, examId);
    if (
      input.maxMarks !== undefined &&
      (await transaction.examResult.count({
        where: {
          centerId: actor.centerId,
          examId,
          marks: { gt: input.maxMarks },
        },
      })) > 0
    ) {
      throw new AppError(
        409,
        "MAX_MARKS_BELOW_EXISTING_RESULT",
        "maxMarks cannot be lower than an already recorded result",
      );
    }

    const result = await transaction.exam.updateMany({
      where: { id: exam.id, centerId: actor.centerId },
      data: {
        ...input,
        date: input.date === undefined ? undefined : examDate(input.date),
      },
    });
    if (result.count === 0) {
      throw new AppError(404, "NOT_FOUND", "Exam not found");
    }
    return transaction.exam.findFirstOrThrow({
      where: { id: examId, centerId: actor.centerId },
    });
  });

export const deleteExam = (actor: ExamActor, examId: string) =>
  withTenant(actor.centerId, async (transaction) => {
    await lockExam(transaction, actor.centerId, examId);
    await requireAccessibleExam(transaction, actor, examId);
    await transaction.exam.deleteMany({
      where: { id: examId, centerId: actor.centerId },
    });
  });

export const upsertExamResults = (
  actor: ExamActor,
  examId: string,
  input: UpsertExamResultsInput,
) =>
  withTenant(actor.centerId, async (transaction) => {
    await lockExam(transaction, actor.centerId, examId);
    const exam = await requireAccessibleExam(transaction, actor, examId);
    const studentIds = [...new Set(input.results.map(({ studentId }) => studentId))];
    const enrollments = await transaction.batchStudent.findMany({
      where: {
        centerId: actor.centerId,
        batchId: exam.batchId,
        studentId: { in: studentIds },
      },
      select: { studentId: true },
    });
    const enrolledIds = new Set(enrollments.map(({ studentId }) => studentId));
    const invalidIds = studentIds.filter((studentId) => !enrolledIds.has(studentId));
    if (invalidIds.length > 0) {
      throw new AppError(
        422,
        "NOT_ENROLLED",
        `These students are not enrolled in this batch: ${invalidIds.join(", ")}`,
      );
    }

    const outOfRangeIds = input.results
      .filter(({ marks }) => marks > exam.maxMarks)
      .map(({ studentId }) => studentId);
    if (outOfRangeIds.length > 0) {
      throw new AppError(
        422,
        "INVALID_MARKS",
        `These students have marks above the exam maximum: ${outOfRangeIds.join(", ")}`,
      );
    }

    for (const result of input.results) {
      await transaction.examResult.upsert({
        where: {
          examId_studentId: { examId, studentId: result.studentId },
          centerId: actor.centerId,
        },
        create: {
          centerId: actor.centerId,
          examId,
          studentId: result.studentId,
          marks: result.marks,
        },
        update: { marks: result.marks },
      });
    }
    return getExamRoster(transaction, actor.centerId, exam);
  });

const getExamRoster = async (
  transaction: Parameters<Parameters<typeof withTenant>[1]>[0],
  centerId: string,
  exam: { id: string; batchId: string },
) => {
  const [enrollments, results] = await Promise.all([
    transaction.batchStudent.findMany({
      where: { centerId, batchId: exam.batchId },
      orderBy: [{ enrolledAt: "asc" }, { studentId: "asc" }],
      include: { student: { select: { id: true, name: true, grade: true } } },
    }),
    transaction.examResult.findMany({
      where: { centerId, examId: exam.id },
      select: { studentId: true, marks: true },
    }),
  ]);
  const marksByStudent = new Map(
    results.map(({ studentId, marks }) => [studentId, marks]),
  );
  const marks = results.map(({ marks: resultMarks }) => resultMarks);
  return {
    results: enrollments.map(({ student }) => ({
      student,
      marks: marksByStudent.get(student.id) ?? null,
    })),
    average:
      marks.length === 0
        ? null
        : marks.reduce((total, mark) => total + mark, 0) / marks.length,
    highestMark: marks.length === 0 ? null : Math.max(...marks),
  };
};

export const getExamResults = (actor: ExamActor, examId: string) =>
  withTenant(actor.centerId, async (transaction) => {
    const exam = await requireAccessibleExam(transaction, actor, examId);
    return getExamRoster(transaction, actor.centerId, exam);
  });

export const getStudentResults = (
  actor: ExamActor,
  studentId: string,
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
    return transaction.examResult.findMany({
      where: {
        centerId: actor.centerId,
        studentId,
        ...(assignedBatches
          ? {
              exam: {
                batchId: { in: assignedBatches.map(({ batchId }) => batchId) },
              },
            }
          : {}),
      },
      orderBy: [{ createdAt: "desc" }, { examId: "asc" }],
      include: {
        exam: {
          select: {
            id: true,
            name: true,
            maxMarks: true,
            date: true,
            batch: { select: { id: true, name: true } },
          },
        },
      },
    });
  });
