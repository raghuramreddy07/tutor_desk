import {
  calendarDateToUtc,
  dateToCalendarString,
  todayInBusinessTimeZone,
} from "../../lib/dates";
import { assertParentOfStudent, listLinkedStudentIds } from "../../lib/parentAccess";
import { withTenant } from "../../lib/tenantDb";
import { AppError } from "../../middleware/errors";
import { getStudentDues } from "../fees/service";
import type {
  ParentAttendanceQuery,
  ParentPaginationQuery,
} from "./schemas";

const parentNotFound = (): AppError =>
  new AppError(404, "NOT_FOUND", "Student not found");

const dateDaysBefore = (date: string, days: number): string => {
  const value = calendarDateToUtc(date);
  value.setUTCDate(value.getUTCDate() - days);
  return dateToCalendarString(value);
};

const assertDateRange = (from: string, to: string): void => {
  const fromDate = calendarDateToUtc(from);
  const toDate = calendarDateToUtc(to);
  const days = Math.floor((toDate.getTime() - fromDate.getTime()) / 86_400_000) + 1;
  if (days > 366) {
    throw new AppError(
      400,
      "VALIDATION_ERROR",
      "Attendance date range cannot exceed 366 days",
    );
  }
};

const percentage = (numerator: number, denominator: number): number =>
  denominator === 0 ? 0 : Math.round((numerator / denominator) * 1000) / 10;

export const listParentChildren = (centerId: string, userId: string) =>
  withTenant(centerId, async (transaction) => {
    const linkedIds = await listLinkedStudentIds(transaction, centerId, userId);
    if (linkedIds.length === 0) {
      return { children: [] };
    }

    const students = await transaction.student.findMany({
      where: { centerId, id: { in: linkedIds } },
      select: {
        id: true,
        name: true,
        grade: true,
        enrollments: {
          where: { centerId },
          orderBy: [{ enrolledAt: "asc" }, { batchId: "asc" }],
          select: {
            batch: {
              select: {
                name: true,
                subject: true,
                schedule: true,
              },
            },
          },
        },
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    });

    return {
      children: students.map(({ enrollments, ...student }) => ({
        ...student,
        batches: enrollments.map(({ batch }) => batch),
      })),
    };
  });

export const getParentChildOverview = (
  centerId: string,
  userId: string,
  studentId: string,
) =>
  withTenant(centerId, async (transaction) => {
    await assertParentOfStudent(transaction, centerId, userId, studentId);
    const student = await transaction.student.findFirst({
      where: { id: studentId, centerId },
      select: { id: true, name: true, grade: true },
    });
    if (!student) {
      throw parentNotFound();
    }

    const today = todayInBusinessTimeZone();
    const from = dateDaysBefore(today, 29);
    const [attendance, latestResult] = await Promise.all([
      transaction.attendance.groupBy({
        by: ["status"],
        where: {
          centerId,
          studentId,
          date: { gte: calendarDateToUtc(from), lte: calendarDateToUtc(today) },
        },
        _count: { _all: true },
      }),
      transaction.examResult.findFirst({
        where: { centerId, studentId },
        orderBy: [{ exam: { date: "desc" } }, { updatedAt: "desc" }],
        select: {
          marks: true,
          exam: {
            select: {
              name: true,
              date: true,
              maxMarks: true,
            },
          },
        },
      }),
    ]);
    const counts = { PRESENT: 0, ABSENT: 0, LATE: 0 };
    for (const row of attendance) {
      counts[row.status] = row._count._all;
    }
    const attended = counts.PRESENT + counts.ABSENT + counts.LATE;
    const result = latestResult
      ? {
          examName: latestResult.exam.name,
          date: dateToCalendarString(latestResult.exam.date),
          marks: latestResult.marks,
          maxMarks: latestResult.exam.maxMarks,
          percentage: percentage(latestResult.marks, latestResult.exam.maxMarks),
        }
      : null;

    return {
      student,
      attendance: {
        from,
        to: today,
        present: counts.PRESENT,
        absent: counts.ABSENT,
        late: counts.LATE,
        percentage: percentage(counts.PRESENT, attended),
      },
      latestExamResult: result,
    };
  }).then(async (overview) => {
    const { totals } = await getStudentDues(centerId, studentId);
    return {
      ...overview,
      fees: {
        totalOutstandingPaise: totals.totalOutstandingPaise,
        totalOverduePaise: totals.totalOverduePaise,
      },
    };
  });

export const listParentAttendance = (
  centerId: string,
  userId: string,
  studentId: string,
  query: ParentAttendanceQuery,
) =>
  withTenant(centerId, async (transaction) => {
    await assertParentOfStudent(transaction, centerId, userId, studentId);
    const today = todayInBusinessTimeZone();
    const from = query.from ?? dateDaysBefore(today, 29);
    const to = query.to ?? today;
    assertDateRange(from, to);
    const where = {
      centerId,
      studentId,
      date: { gte: calendarDateToUtc(from), lte: calendarDateToUtc(to) },
    };
    const [rows, grouped, total] = await Promise.all([
      transaction.attendance.findMany({
        where,
        orderBy: [{ date: "desc" }, { batchId: "asc" }],
        take: query.limit,
        skip: query.offset,
        select: {
          date: true,
          status: true,
          enrollment: {
            select: { batch: { select: { name: true } } },
          },
        },
      }),
      transaction.attendance.groupBy({
        by: ["status"],
        where,
        _count: { _all: true },
      }),
      transaction.attendance.count({ where }),
    ]);
    const counts = { PRESENT: 0, ABSENT: 0, LATE: 0 };
    for (const row of grouped) {
      counts[row.status] = row._count._all;
    }
    return {
      records: rows.map(({ date, status, enrollment }) => ({
        date: dateToCalendarString(date),
        batchName: enrollment.batch.name,
        status,
      })),
      counts,
      percentage: percentage(counts.PRESENT, total),
      total,
      from,
      to,
      limit: query.limit,
      offset: query.offset,
    };
  });

export const listParentResults = (
  centerId: string,
  userId: string,
  studentId: string,
) =>
  withTenant(centerId, async (transaction) => {
    await assertParentOfStudent(transaction, centerId, userId, studentId);
    const results = await transaction.examResult.findMany({
      where: { centerId, studentId },
      orderBy: [{ exam: { date: "desc" } }, { examId: "asc" }],
      select: {
        marks: true,
        exam: {
          select: {
            id: true,
            name: true,
            date: true,
            maxMarks: true,
            batch: { select: { name: true } },
          },
        },
      },
    });
    if (results.length === 0) {
      return { results: [] };
    }
    const examIds = results.map(({ exam }) => exam.id);
    const averages = await transaction.examResult.groupBy({
      by: ["examId"],
      where: { centerId, examId: { in: examIds } },
      _avg: { marks: true },
    });
    const averageByExam = new Map(
      averages.map(({ examId, _avg }) => [examId, _avg.marks ?? 0]),
    );
    return {
      results: results.map(({ marks, exam }) => ({
        examName: exam.name,
        batchName: exam.batch.name,
        date: dateToCalendarString(exam.date),
        marks,
        maxMarks: exam.maxMarks,
        percentage: percentage(marks, exam.maxMarks),
        classAverage: Math.round((averageByExam.get(exam.id) ?? 0) * 10) / 10,
      })),
    };
  });

export const getParentStudentDues = async (
  centerId: string,
  userId: string,
  studentId: string,
) => {
  await withTenant(centerId, (transaction) =>
    assertParentOfStudent(transaction, centerId, userId, studentId),
  );
  return getStudentDues(centerId, studentId);
};

export const listParentPayments = (
  centerId: string,
  userId: string,
  studentId: string,
  query: ParentPaginationQuery,
) =>
  withTenant(centerId, async (transaction) => {
    await assertParentOfStudent(transaction, centerId, userId, studentId);
    const where = { centerId, studentId, voidedAt: null };
    const [payments, total] = await Promise.all([
      transaction.payment.findMany({
        where,
        orderBy: [{ paidOn: "desc" }, { createdAt: "desc" }],
        take: query.limit,
        skip: query.offset,
        select: {
          receiptNumber: true,
          amountPaise: true,
          paidOn: true,
          method: true,
          reference: true,
        },
      }),
      transaction.payment.count({ where }),
    ]);
    return {
      payments: payments.map((payment) => ({
        ...payment,
        amountPaise: payment.amountPaise.toString(),
        paidOn: dateToCalendarString(payment.paidOn),
      })),
      total,
      limit: query.limit,
      offset: query.offset,
    };
  });

export const getParentPaymentReceipt = (
  centerId: string,
  userId: string,
  studentId: string,
  paymentId: string,
) =>
  withTenant(centerId, async (transaction) => {
    await assertParentOfStudent(transaction, centerId, userId, studentId);
    const payment = await transaction.payment.findFirst({
      where: { id: paymentId, centerId, studentId, voidedAt: null },
      select: {
        receiptNumber: true,
        amountPaise: true,
        paidOn: true,
        method: true,
        reference: true,
        center: { select: { name: true } },
        student: { select: { name: true } },
        allocations: {
          where: { centerId },
          orderBy: { charge: { dueDate: "asc" } },
          select: {
            amountPaise: true,
            charge: {
              select: {
                description: true,
                dueDate: true,
              },
            },
          },
        },
      },
    });
    if (!payment) {
      throw parentNotFound();
    }
    return {
      receipt: {
        centerName: payment.center.name,
        receiptNumber: payment.receiptNumber,
        studentName: payment.student.name,
        amountPaise: payment.amountPaise.toString(),
        method: payment.method,
        paidOn: dateToCalendarString(payment.paidOn),
        reference: payment.reference,
        charges: payment.allocations.map(({ amountPaise, charge }) => ({
          description: charge.description,
          dueDate: dateToCalendarString(charge.dueDate),
          amountPaise: amountPaise.toString(),
        })),
      },
    };
  });
