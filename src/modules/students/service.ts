import { AppError } from "../../middleware/errors";
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
  withTenant(centerId, (transaction) =>
    transaction.student.create({
      data: {
        ...input,
        centerId,
      },
    }),
  );

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
    const result = await transaction.student.deleteMany({
      where: { id, centerId },
    });

    if (result.count === 0) {
      throw studentNotFound();
    }
  });
