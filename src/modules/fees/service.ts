import { Prisma } from "@prisma/client";
import {
  calendarDateToUtc,
  dateToCalendarString,
  latestAllowedChargeMonth,
  todayInBusinessTimeZone,
} from "../../lib/dates";
import { parsePaise, paiseToJson } from "../../lib/money";
import { withTenant } from "../../lib/tenantDb";
import { AppError } from "../../middleware/errors";
import type {
  CreateStudentFeeInput,
  FeeDuesSummaryQuery,
  OverdueQuery,
  UpdateStudentFeeInput,
} from "./schemas";

const feeBalancesCte = (centerId: string) => Prisma.sql`
  WITH paid AS (
    SELECT allocation."centerId",
           allocation."chargeId",
           SUM(allocation."amountPaise")::bigint AS "paidPaise"
    FROM "PaymentAllocation" allocation
    JOIN "Payment" payment
      ON payment."centerId" = allocation."centerId"
     AND payment."id" = allocation."paymentId"
     AND payment."voidedAt" IS NULL
    WHERE allocation."centerId" = ${centerId}::uuid
      AND payment."centerId" = ${centerId}::uuid
    GROUP BY allocation."centerId", allocation."chargeId"
  ),
  balances AS (
    SELECT charge."id",
           charge."centerId",
           charge."studentId",
           plan."batchId",
           batch."name" AS "batchName",
           charge."periodStart",
           charge."dueDate",
           charge."amountPaise",
           charge."waivedAt",
           CASE
             WHEN charge."waivedAt" IS NOT NULL THEN 0::bigint
             ELSE COALESCE(paid."paidPaise", 0::bigint)
           END AS "paidPaise",
           CASE
             WHEN charge."waivedAt" IS NOT NULL THEN 0::bigint
             ELSE charge."amountPaise" - COALESCE(paid."paidPaise", 0::bigint)
           END AS "outstandingPaise"
    FROM "FeeCharge" charge
    JOIN "StudentFee" studentFee
      ON studentFee."centerId" = charge."centerId"
     AND studentFee."id" = charge."studentFeeId"
    JOIN "FeePlan" plan
      ON plan."centerId" = studentFee."centerId"
     AND plan."id" = studentFee."feePlanId"
    JOIN "Batch" batch
      ON batch."centerId" = plan."centerId"
     AND batch."id" = plan."batchId"
    LEFT JOIN paid
      ON paid."centerId" = charge."centerId"
     AND paid."chargeId" = charge."id"
    WHERE charge."centerId" = ${centerId}::uuid
      AND studentFee."centerId" = ${centerId}::uuid
      AND plan."centerId" = ${centerId}::uuid
      AND batch."centerId" = ${centerId}::uuid
  )
`;

const chargeStatus = (
  row: { waivedAt: Date | null; outstandingPaise: bigint; paidPaise: bigint; dueDate: Date },
  today: string,
): "PAID" | "PARTIAL" | "UNPAID" | "OVERDUE" | "WAIVED" => {
  if (row.waivedAt !== null) {
    return "WAIVED";
  }
  if (row.outstandingPaise === 0n) {
    return "PAID";
  }
  if (dateToCalendarString(row.dueDate) < today) {
    return "OVERDUE";
  }
  return row.paidPaise > 0n ? "PARTIAL" : "UNPAID";
};

const serializeStudentFee = <
  T extends {
    customAmountPaise: bigint | null;
    feePlan?: { amountPaise: bigint };
  },
>(
  studentFee: T,
) => ({
  ...studentFee,
  customAmountPaise:
    studentFee.customAmountPaise === null
      ? null
      : paiseToJson(studentFee.customAmountPaise),
  ...(studentFee.feePlan
    ? {
        feePlan: {
          ...studentFee.feePlan,
          amountPaise: paiseToJson(studentFee.feePlan.amountPaise),
        },
      }
    : {}),
});

export const createStudentFee = (
  centerId: string,
  studentId: string,
  input: CreateStudentFeeInput,
) =>
  withTenant(centerId, async (transaction) => {
    const student = await transaction.student.findFirst({
      where: { id: studentId, centerId },
      select: { id: true },
    });
    if (!student) {
      throw new AppError(404, "NOT_FOUND", "Student not found");
    }

    await transaction.$queryRaw`
      SELECT "id" FROM "Student"
      WHERE "id" = ${studentId}::uuid AND "centerId" = ${centerId}::uuid
      FOR UPDATE
    `;
    const planLock = await transaction.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "FeePlan"
      WHERE "id" = ${input.feePlanId}::uuid
        AND "centerId" = ${centerId}::uuid
        AND "isActive" = true
      FOR SHARE
    `;
    if (planLock.length === 0) {
      throw new AppError(404, "NOT_FOUND", "Fee plan not found");
    }
    const plan = await transaction.feePlan.findFirstOrThrow({
      where: { id: input.feePlanId, centerId },
      select: { batchId: true },
    });
    const enrollment = await transaction.batchStudent.findFirst({
      where: { centerId, batchId: plan.batchId, studentId },
      select: { id: true },
    });
    if (!enrollment) {
      throw new AppError(
        422,
        "STUDENT_NOT_ENROLLED",
        "Student must be enrolled in the fee plan's batch",
      );
    }

    const overlappingAssignment = await transaction.studentFee.findFirst({
      where: {
        centerId,
        studentId,
        feePlanId: input.feePlanId,
        startDate: { lte: calendarDateToUtc(input.endDate ?? "9999-12-31") },
        OR: [
          { endDate: null },
          { endDate: { gte: calendarDateToUtc(input.startDate) } },
        ],
      },
      select: { id: true },
    });
    if (overlappingAssignment) {
      throw new AppError(
        409,
        "FEE_ALREADY_ASSIGNED",
        "This fee plan is already assigned to the student for an overlapping date range",
      );
    }

    const studentFee = await transaction.studentFee.create({
      data: {
        centerId,
        studentId,
        feePlanId: input.feePlanId,
        customAmountPaise:
          input.customAmountPaise == null
            ? null
            : parsePaise(input.customAmountPaise),
        startDate: calendarDateToUtc(input.startDate),
        endDate:
          input.endDate === undefined
            ? null
            : calendarDateToUtc(input.endDate),
      },
      include: {
        feePlan: {
          select: {
            id: true,
            name: true,
            amountPaise: true,
            frequency: true,
            dueDay: true,
          },
        },
      },
    });
    return serializeStudentFee(studentFee);
  });

export const listStudentFees = (centerId: string, studentId: string) =>
  withTenant(centerId, async (transaction) => {
    const student = await transaction.student.findFirst({
      where: { id: studentId, centerId },
      select: { id: true },
    });
    if (!student) {
      throw new AppError(404, "NOT_FOUND", "Student not found");
    }
    const studentFees = await transaction.studentFee.findMany({
      where: { centerId, studentId },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      include: {
        feePlan: {
          select: {
            id: true,
            name: true,
            amountPaise: true,
            frequency: true,
            dueDay: true,
            isActive: true,
          },
        },
      },
    });
    return studentFees.map(serializeStudentFee);
  });

export const updateStudentFee = (
  centerId: string,
  studentId: string,
  studentFeeId: string,
  input: UpdateStudentFeeInput,
) =>
  withTenant(centerId, async (transaction) => {
    await transaction.$queryRaw`
      SELECT "id" FROM "Student"
      WHERE "id" = ${studentId}::uuid AND "centerId" = ${centerId}::uuid
      FOR UPDATE
    `;
    await transaction.$queryRaw`
      SELECT "id" FROM "StudentFee"
      WHERE "id" = ${studentFeeId}::uuid
        AND "centerId" = ${centerId}::uuid
        AND "studentId" = ${studentId}::uuid
      FOR UPDATE
    `;
    const existing = await transaction.studentFee.findFirst({
      where: { id: studentFeeId, centerId, studentId },
      select: { id: true, startDate: true, feePlanId: true },
    });
    if (!existing) {
      throw new AppError(404, "NOT_FOUND", "Student fee assignment not found");
    }
    if (
      typeof input.endDate === "string" &&
      input.endDate < dateToCalendarString(existing.startDate)
    ) {
      throw new AppError(
        400,
        "VALIDATION_ERROR",
        "endDate must not be before startDate",
      );
    }

    const nextEndDate =
      input.endDate === undefined
        ? null
        : input.endDate === null
          ? null
          : calendarDateToUtc(input.endDate);
    if (input.endDate !== undefined) {
      const endDateForOverlap =
        nextEndDate ?? calendarDateToUtc("9999-12-31");
      const overlap = await transaction.studentFee.findFirst({
        where: {
          centerId,
          studentId,
          feePlanId: existing.feePlanId,
          id: { not: studentFeeId },
          startDate: { lte: endDateForOverlap },
          OR: [
            { endDate: null },
            { endDate: { gte: existing.startDate } },
          ],
        },
        select: { id: true },
      });
      if (overlap) {
        throw new AppError(
          409,
          "FEE_ALREADY_ASSIGNED",
          "This fee plan is already assigned to the student for an overlapping date range",
        );
      }
    }

    await transaction.studentFee.updateMany({
      where: { id: studentFeeId, centerId, studentId },
      data: {
        ...(input.customAmountPaise !== undefined
          ? {
              customAmountPaise:
                input.customAmountPaise === null
                  ? null
                  : parsePaise(input.customAmountPaise),
            }
          : {}),
        ...(input.endDate !== undefined
          ? {
              endDate: nextEndDate,
            }
          : {}),
      },
    });
    const studentFee = await transaction.studentFee.findFirstOrThrow({
      where: { id: studentFeeId, centerId, studentId },
      include: {
        feePlan: {
          select: {
            id: true,
            name: true,
            amountPaise: true,
            frequency: true,
            dueDay: true,
            isActive: true,
          },
        },
      },
    });
    return serializeStudentFee(studentFee);
  });

export const deleteStudentFee = (
  centerId: string,
  studentId: string,
  studentFeeId: string,
) =>
  withTenant(centerId, async (transaction) => {
    await transaction.$queryRaw`
      SELECT "id" FROM "Student"
      WHERE "id" = ${studentId}::uuid AND "centerId" = ${centerId}::uuid
      FOR UPDATE
    `;
    await transaction.$queryRaw`
      SELECT "id" FROM "StudentFee"
      WHERE "id" = ${studentFeeId}::uuid
        AND "centerId" = ${centerId}::uuid
        AND "studentId" = ${studentId}::uuid
      FOR UPDATE
    `;
    const existing = await transaction.studentFee.findFirst({
      where: { id: studentFeeId, centerId, studentId },
      select: { startDate: true, endDate: true },
    });
    if (!existing) {
      throw new AppError(404, "NOT_FOUND", "Student fee assignment not found");
    }

    const chargeCount = await transaction.feeCharge.count({
      where: { centerId, studentFeeId },
    });
    if (chargeCount === 0) {
      await transaction.studentFee.deleteMany({
        where: { id: studentFeeId, centerId, studentId },
      });
      return { removed: true, endDate: null };
    }

    const today = todayInBusinessTimeZone();
    const existingEndDate =
      existing.endDate === null ? null : dateToCalendarString(existing.endDate);
    const todayOrStart =
      today < dateToCalendarString(existing.startDate)
        ? dateToCalendarString(existing.startDate)
        : today;
    const endDate =
      existingEndDate !== null && existingEndDate < todayOrStart
        ? existingEndDate
        : todayOrStart;
    await transaction.studentFee.updateMany({
      where: { id: studentFeeId, centerId, studentId },
      data: { endDate: calendarDateToUtc(endDate) },
    });
    return { removed: false, endDate };
  });

export const generateFeeCharges = (centerId: string, month: string) =>
  withTenant(centerId, async (transaction) => {
    if (month > latestAllowedChargeMonth()) {
      throw new AppError(
        400,
        "VALIDATION_ERROR",
        "Charges can be generated no more than one month ahead",
      );
    }

    await transaction.$queryRaw`
      SELECT sf."id"
      FROM "StudentFee" sf
      JOIN "FeePlan" fp
        ON fp."centerId" = sf."centerId" AND fp."id" = sf."feePlanId"
      WHERE sf."centerId" = ${centerId}::uuid
        AND fp."isActive" = true
        AND (
          (
            fp."frequency" = 'MONTHLY'
            AND sf."startDate" <=
              (${calendarDateToUtc(`${month}-01`)}::date + INTERVAL '1 month' - INTERVAL '1 day')::date
            AND (
              sf."endDate" IS NULL
              OR sf."endDate" >= ${calendarDateToUtc(`${month}-01`)}::date
            )
          )
          OR (
            fp."frequency" = 'ONE_TIME'
            AND sf."startDate" >= ${calendarDateToUtc(`${month}-01`)}::date
            AND sf."startDate" <
              (${calendarDateToUtc(`${month}-01`)}::date + INTERVAL '1 month')::date
            AND (sf."endDate" IS NULL OR sf."endDate" >= sf."startDate")
          )
        )
      FOR SHARE OF sf
    `;

    const results = await transaction.$queryRaw<
      Array<{ createdCount: bigint; candidateCount: bigint }>
    >`
      WITH month_bounds AS (
        SELECT
          ${calendarDateToUtc(`${month}-01`)}::date AS month_start,
          (${calendarDateToUtc(`${month}-01`)}::date + INTERVAL '1 month')::date AS next_month
      ),
      candidates AS MATERIALIZED (
        SELECT
          sf."centerId",
          sf."studentId",
          sf."id" AS "studentFeeId",
          bounds.month_start AS "periodStart",
          make_date(
            EXTRACT(YEAR FROM bounds.month_start)::integer,
            EXTRACT(MONTH FROM bounds.month_start)::integer,
            fp."dueDay"
          ) AS "dueDate",
          COALESCE(sf."customAmountPaise", fp."amountPaise") AS "amountPaise",
          fp."name" || ' - ' || to_char(bounds.month_start, 'YYYY-MM') AS "description"
        FROM "StudentFee" sf
        JOIN "FeePlan" fp
          ON fp."centerId" = sf."centerId" AND fp."id" = sf."feePlanId"
        CROSS JOIN month_bounds bounds
        WHERE sf."centerId" = ${centerId}::uuid
          AND fp."isActive" = true
          AND fp."frequency" = 'MONTHLY'
          AND sf."startDate" <= (bounds.next_month - INTERVAL '1 day')::date
          AND (sf."endDate" IS NULL OR sf."endDate" >= bounds.month_start)

        UNION ALL

        SELECT
          sf."centerId",
          sf."studentId",
          sf."id" AS "studentFeeId",
          sf."startDate" AS "periodStart",
          sf."startDate" AS "dueDate",
          COALESCE(sf."customAmountPaise", fp."amountPaise") AS "amountPaise",
          fp."name" AS "description"
        FROM "StudentFee" sf
        JOIN "FeePlan" fp
          ON fp."centerId" = sf."centerId" AND fp."id" = sf."feePlanId"
        CROSS JOIN month_bounds bounds
        WHERE sf."centerId" = ${centerId}::uuid
          AND fp."isActive" = true
          AND fp."frequency" = 'ONE_TIME'
          AND sf."startDate" >= bounds.month_start
          AND sf."startDate" < bounds.next_month
          AND (sf."endDate" IS NULL OR sf."endDate" >= sf."startDate")
      ),
      inserted AS (
        INSERT INTO "FeeCharge" (
          "id", "centerId", "studentId", "studentFeeId", "periodStart",
          "dueDate", "amountPaise", "description"
        )
        SELECT
          gen_random_uuid(), "centerId", "studentId", "studentFeeId",
          "periodStart", "dueDate", "amountPaise", "description"
        FROM candidates
        ON CONFLICT ("studentFeeId", "periodStart") DO NOTHING
        RETURNING "id"
      )
      SELECT
        (SELECT count(*) FROM inserted)::bigint AS "createdCount",
        (SELECT count(*) FROM candidates)::bigint AS "candidateCount"
    `;
    const createdCount = Number(results[0]?.createdCount ?? 0n);
    const candidateCount = Number(results[0]?.candidateCount ?? 0n);
    return {
      month,
      created: createdCount,
      alreadyExisted: candidateCount - createdCount,
    };
  });

export const waiveFeeCharge = (
  centerId: string,
  userId: string,
  chargeId: string,
  reason: string,
) =>
  withTenant(centerId, async (transaction) => {
    const locked = await transaction.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "FeeCharge"
      WHERE "id" = ${chargeId}::uuid AND "centerId" = ${centerId}::uuid
      FOR UPDATE
    `;
    if (locked.length === 0) {
      throw new AppError(404, "NOT_FOUND", "Fee charge not found");
    }
    const charge = await transaction.feeCharge.findFirstOrThrow({
      where: { id: chargeId, centerId },
      select: { waivedAt: true },
    });
    if (charge.waivedAt) {
      throw new AppError(409, "CHARGE_ALREADY_WAIVED", "Fee charge is already waived");
    }
    const allocationCount = await transaction.paymentAllocation.count({
      where: { centerId, chargeId },
    });
    if (allocationCount > 0) {
      throw new AppError(
        409,
        "CHARGE_HAS_PAYMENTS",
        "A charge with payment allocations cannot be waived",
      );
    }
    await transaction.feeCharge.updateMany({
      where: { id: chargeId, centerId },
      data: {
        waivedAt: new Date(),
        waivedByUserId: userId,
        waiveReason: reason,
      },
    });
    const updated = await transaction.feeCharge.findFirstOrThrow({
      where: { id: chargeId, centerId },
    });
    return { ...updated, amountPaise: paiseToJson(updated.amountPaise) };
  });

export const unwaiveFeeCharge = (centerId: string, chargeId: string) =>
  withTenant(centerId, async (transaction) => {
    const result = await transaction.feeCharge.updateMany({
      where: { id: chargeId, centerId, waivedAt: { not: null } },
      data: { waivedAt: null, waivedByUserId: null, waiveReason: null },
    });
    if (result.count === 0) {
      const charge = await transaction.feeCharge.findFirst({
        where: { id: chargeId, centerId },
        select: { id: true },
      });
      if (!charge) {
        throw new AppError(404, "NOT_FOUND", "Fee charge not found");
      }
      throw new AppError(409, "CHARGE_NOT_WAIVED", "Fee charge is not waived");
    }
    const charge = await transaction.feeCharge.findFirstOrThrow({
      where: { id: chargeId, centerId },
    });
    return { ...charge, amountPaise: paiseToJson(charge.amountPaise) };
  });

export const getStudentDues = (centerId: string, studentId: string) =>
  withTenant(centerId, async (transaction) => {
    const student = await transaction.student.findFirst({
      where: { id: studentId, centerId },
      select: { id: true },
    });
    if (!student) {
      throw new AppError(404, "NOT_FOUND", "Student not found");
    }

    type ChargeRow = {
      id: string;
      batchId: string;
      batchName: string;
      periodStart: Date;
      dueDate: Date;
      amountPaise: bigint;
      paidPaise: bigint;
      outstandingPaise: bigint;
      waivedAt: Date | null;
    };
    const rows = await transaction.$queryRaw<ChargeRow[]>(Prisma.sql`
      ${feeBalancesCte(centerId)}
      SELECT "id", "batchId", "batchName", "periodStart", "dueDate",
             "amountPaise", "paidPaise", "outstandingPaise", "waivedAt"
      FROM balances
      WHERE "studentId" = ${studentId}::uuid
      ORDER BY "dueDate" ASC, "id" ASC
    `);
    const totals = await transaction.$queryRaw<
      Array<{
        totalChargedPaise: bigint;
        totalPaidPaise: bigint;
        totalOutstandingPaise: bigint;
        totalOverduePaise: bigint;
      }>
    >(Prisma.sql`
      ${feeBalancesCte(centerId)}
      SELECT
        COALESCE(SUM("amountPaise") FILTER (WHERE "waivedAt" IS NULL), 0)::bigint AS "totalChargedPaise",
        COALESCE(SUM("paidPaise"), 0)::bigint AS "totalPaidPaise",
        COALESCE(SUM("outstandingPaise"), 0)::bigint AS "totalOutstandingPaise",
        COALESCE(
          SUM("outstandingPaise") FILTER (
            WHERE "waivedAt" IS NULL
              AND "outstandingPaise" > 0
              AND "dueDate" < ${todayInBusinessTimeZone()}::date
          ),
          0
        )::bigint AS "totalOverduePaise"
      FROM balances
      WHERE "studentId" = ${studentId}::uuid
    `);
    const totalsRow = totals[0];
    if (!totalsRow) {
      throw new Error("Student dues aggregate did not return a row");
    }

    return {
      dues: rows.map((row) => ({
        chargeId: row.id,
        batchId: row.batchId,
        batchName: row.batchName,
        periodStart: dateToCalendarString(row.periodStart),
        dueDate: dateToCalendarString(row.dueDate),
        amountPaise: paiseToJson(row.amountPaise),
        paidPaise: paiseToJson(row.paidPaise),
        outstandingPaise: paiseToJson(row.outstandingPaise),
        status: chargeStatus(row, todayInBusinessTimeZone()),
      })),
      totals: {
        totalChargedPaise: paiseToJson(totalsRow.totalChargedPaise),
        totalPaidPaise: paiseToJson(totalsRow.totalPaidPaise),
        totalOutstandingPaise: paiseToJson(totalsRow.totalOutstandingPaise),
        totalOverduePaise: paiseToJson(totalsRow.totalOverduePaise),
      },
    };
  });

export const getFeeDuesSummary = (
  centerId: string,
  query: FeeDuesSummaryQuery,
) =>
  withTenant(centerId, async (transaction) => {
    if (query.batchId) {
      const batch = await transaction.batch.findFirst({
        where: { id: query.batchId, centerId },
        select: { id: true },
      });
      if (!batch) {
        throw new AppError(404, "NOT_FOUND", "Batch not found");
      }
    }

    const batchFilter = query.batchId
      ? Prisma.sql`AND batch."id" = ${query.batchId}::uuid`
      : Prisma.empty;
    const countFilter = query.batchId
      ? Prisma.sql`AND "id" = ${query.batchId}::uuid`
      : Prisma.empty;
    const batches = await transaction.$queryRaw<
      Array<{
        batchId: string;
        batchName: string;
        studentCount: bigint;
        totalChargedPaise: bigint;
        totalPaidPaise: bigint;
        totalOutstandingPaise: bigint;
        totalOverduePaise: bigint;
      }>
    >(Prisma.sql`
      ${feeBalancesCte(centerId)}
      SELECT batch."id" AS "batchId",
             batch."name" AS "batchName",
             COUNT(DISTINCT balances."studentId")::bigint AS "studentCount",
             COALESCE(SUM(balances."amountPaise") FILTER (WHERE balances."waivedAt" IS NULL), 0)::bigint AS "totalChargedPaise",
             COALESCE(SUM(balances."paidPaise"), 0)::bigint AS "totalPaidPaise",
             COALESCE(SUM(balances."outstandingPaise"), 0)::bigint AS "totalOutstandingPaise",
             COALESCE(
               SUM(balances."outstandingPaise") FILTER (
                 WHERE balances."waivedAt" IS NULL
                   AND balances."outstandingPaise" > 0
                   AND balances."dueDate" < ${todayInBusinessTimeZone()}::date
               ),
               0
             )::bigint AS "totalOverduePaise"
      FROM "Batch" batch
      LEFT JOIN balances ON balances."batchId" = batch."id"
      WHERE batch."centerId" = ${centerId}::uuid
        ${batchFilter}
      GROUP BY batch."id", batch."name"
      ORDER BY batch."name" ASC, batch."id" ASC
      LIMIT ${query.limit} OFFSET ${query.offset}
    `);
    const batchCounts = await transaction.$queryRaw<Array<{ total: bigint }>>(
      Prisma.sql`
        SELECT COUNT(*)::bigint AS total
        FROM "Batch"
        WHERE "centerId" = ${centerId}::uuid ${countFilter}
      `,
    );
    const total = batchCounts[0]?.total;
    if (total === undefined) {
      throw new Error("Batch count query did not return a row");
    }

    const result = {
      batches: batches.map((batch) => ({
        batchId: batch.batchId,
        batchName: batch.batchName,
        studentCount: Number(batch.studentCount),
        totalChargedPaise: paiseToJson(batch.totalChargedPaise),
        totalPaidPaise: paiseToJson(batch.totalPaidPaise),
        totalOutstandingPaise: paiseToJson(batch.totalOutstandingPaise),
        totalOverduePaise: paiseToJson(batch.totalOverduePaise),
      })),
      total: Number(total),
      limit: query.limit,
      offset: query.offset,
    };
    if (!query.batchId) {
      return result;
    }

    const students = await transaction.$queryRaw<
      Array<{
        studentId: string;
        studentName: string;
        totalChargedPaise: bigint;
        totalPaidPaise: bigint;
        totalOutstandingPaise: bigint;
        totalOverduePaise: bigint;
      }>
    >(Prisma.sql`
      ${feeBalancesCte(centerId)}
      SELECT student."id" AS "studentId",
             student."name" AS "studentName",
             COALESCE(SUM(balances."amountPaise") FILTER (WHERE balances."waivedAt" IS NULL), 0)::bigint AS "totalChargedPaise",
             COALESCE(SUM(balances."paidPaise"), 0)::bigint AS "totalPaidPaise",
             COALESCE(SUM(balances."outstandingPaise"), 0)::bigint AS "totalOutstandingPaise",
             COALESCE(
               SUM(balances."outstandingPaise") FILTER (
                 WHERE balances."waivedAt" IS NULL
                   AND balances."outstandingPaise" > 0
                   AND balances."dueDate" < ${todayInBusinessTimeZone()}::date
               ),
               0
             )::bigint AS "totalOverduePaise"
      FROM balances
      JOIN "Student" student
        ON student."centerId" = balances."centerId"
       AND student."id" = balances."studentId"
      WHERE balances."batchId" = ${query.batchId}::uuid
        AND student."centerId" = ${centerId}::uuid
      GROUP BY student."id", student."name"
      ORDER BY student."name" ASC, student."id" ASC
      LIMIT ${query.limit} OFFSET ${query.offset}
    `);
    const studentCounts = await transaction.$queryRaw<
      Array<{ total: bigint }>
    >(Prisma.sql`
      ${feeBalancesCte(centerId)}
      SELECT COUNT(DISTINCT "studentId")::bigint AS total
      FROM balances
      WHERE "batchId" = ${query.batchId}::uuid
    `);
    const studentsTotal = studentCounts[0]?.total;
    if (studentsTotal === undefined) {
      throw new Error("Student count query did not return a row");
    }
    return {
      ...result,
      students: students.map((student) => ({
        studentId: student.studentId,
        studentName: student.studentName,
        totalChargedPaise: paiseToJson(student.totalChargedPaise),
        totalPaidPaise: paiseToJson(student.totalPaidPaise),
        totalOutstandingPaise: paiseToJson(student.totalOutstandingPaise),
        totalOverduePaise: paiseToJson(student.totalOverduePaise),
      })),
      studentsTotal: Number(studentsTotal),
    };
  });

export const listOverdueStudents = (
  centerId: string,
  query: OverdueQuery,
) =>
  withTenant(centerId, async (transaction) => {
    const orderBy =
      query.sort === "age"
        ? Prisma.sql`"daysOverdue" DESC, "overduePaise" DESC, "studentId" ASC`
        : Prisma.sql`"overduePaise" DESC, "daysOverdue" DESC, "studentId" ASC`;
    const rows = await transaction.$queryRaw<
      Array<{
        studentId: string;
        studentName: string;
        overduePaise: bigint;
        oldestOverdueDate: Date;
        daysOverdue: number;
        total: bigint;
      }>
    >(Prisma.sql`
      ${feeBalancesCte(centerId)}
      SELECT student."id" AS "studentId",
             student."name" AS "studentName",
             SUM(balances."outstandingPaise")::bigint AS "overduePaise",
             MIN(balances."dueDate") AS "oldestOverdueDate",
             (${todayInBusinessTimeZone()}::date - MIN(balances."dueDate"))::int AS "daysOverdue",
             COUNT(*) OVER()::bigint AS "total"
      FROM balances
      JOIN "Student" student
        ON student."centerId" = balances."centerId"
       AND student."id" = balances."studentId"
      WHERE student."centerId" = ${centerId}::uuid
        AND balances."waivedAt" IS NULL
        AND balances."outstandingPaise" > 0
        AND balances."dueDate" < ${todayInBusinessTimeZone()}::date
      GROUP BY student."id", student."name"
      ORDER BY ${orderBy}
      LIMIT ${query.limit} OFFSET ${query.offset}
    `);
    const total = rows[0]?.total ?? 0n;
    return {
      students: rows.map((row) => ({
        studentId: row.studentId,
        studentName: row.studentName,
        overduePaise: paiseToJson(row.overduePaise),
        oldestOverdueDate: dateToCalendarString(row.oldestOverdueDate),
        daysOverdue: row.daysOverdue,
      })),
      total: Number(total),
      limit: query.limit,
      offset: query.offset,
      sort: query.sort,
    };
  });
