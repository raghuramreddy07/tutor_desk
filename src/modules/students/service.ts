import { AppError } from "../../middleware/errors";
import { assertWithinPlanLimit } from "../../lib/planLimits";
import { withTenant } from "../../lib/tenantDb";
import type {
  CreateStudentInput,
  ListStudentsQuery,
  UpdateStudentInput,
} from "./schemas";

const studentNotFound = (): AppError =>
  new AppError(404, "NOT_FOUND", "Student not found");

export const createStudent = (
  centerId: string,
  input: CreateStudentInput,
) =>
  withTenant(centerId, async (transaction) => {
    await assertWithinPlanLimit(transaction, centerId, "students");
    return transaction.student.create({
      data: {
        ...input,
        centerId,
      },
    });
  });

export const listStudents = (
  centerId: string,
  { limit, offset }: ListStudentsQuery,
) =>
  withTenant(centerId, async (transaction) => {
    const where = { centerId };
    const [students, total] = await Promise.all([
      transaction.student.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        take: limit,
        skip: offset,
      }),
      transaction.student.count({ where }),
    ]);

    return { students, total, limit, offset };
  });

export const getStudent = async (centerId: string, id: string) => {
  const student = await withTenant(centerId, (transaction) =>
    transaction.student.findFirst({
      where: { id, centerId },
    }),
  );

  if (!student) {
    throw studentNotFound();
  }
  return student;
};

export const updateStudent = (
  centerId: string,
  id: string,
  input: UpdateStudentInput,
) =>
  withTenant(centerId, async (transaction) => {
    const result = await transaction.student.updateMany({
      where: { id, centerId },
      data: input,
    });

    if (result.count === 0) {
      throw studentNotFound();
    }

    const student = await transaction.student.findFirst({
      where: { id, centerId },
    });
    if (!student) {
      throw studentNotFound();
    }
    return student;
  });

export const deleteStudent = (centerId: string, id: string) =>
  withTenant(centerId, async (transaction) => {
    await transaction.$queryRaw`
      SELECT "id" FROM "Student"
      WHERE "id" = ${id}::uuid AND "centerId" = ${centerId}::uuid
      FOR UPDATE
    `;
    const student = await transaction.student.findFirst({
      where: { id, centerId },
      select: { id: true },
    });
    if (!student) {
      throw studentNotFound();
    }

    await transaction.$queryRaw`
      SELECT "id" FROM "StudentFee"
      WHERE "centerId" = ${centerId}::uuid AND "studentId" = ${id}::uuid
      FOR UPDATE
    `;
    const [chargeCount, paymentCount] = await Promise.all([
      transaction.feeCharge.count({ where: { centerId, studentId: id } }),
      transaction.payment.count({ where: { centerId, studentId: id } }),
    ]);
    if (chargeCount > 0 || paymentCount > 0) {
      throw new AppError(
        409,
        "STUDENT_HAS_FINANCIAL_HISTORY",
        "A student with fee charges or payments cannot be deleted",
      );
    }
    await transaction.studentFee.deleteMany({
      where: { centerId, studentId: id },
    });

    const result = await transaction.student.deleteMany({
      where: { id, centerId },
    });

    if (result.count === 0) {
      throw studentNotFound();
    }
  });
