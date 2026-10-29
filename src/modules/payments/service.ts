import { Prisma } from "@prisma/client";
import { calendarDateToUtc, dateToCalendarString, todayInBusinessTimeZone } from "../../lib/dates";
import { parsePaise, paiseToJson } from "../../lib/money";
import { withTenant } from "../../lib/tenantDb";
import { AppError } from "../../middleware/errors";
import type { CreatePaymentInput, PaymentListQuery } from "./schemas";
import { recordAudit } from "../../lib/audit";

const serializePayment = <
  T extends {
    amountPaise: bigint;
    allocations?: Array<{
      amountPaise: bigint;
      charge?: { amountPaise: bigint };
    }>;
  },
>(
  payment: T,
) => ({
  ...payment,
  amountPaise: paiseToJson(payment.amountPaise),
  allocations: payment.allocations?.map(({ charge, ...allocation }) => ({
    ...allocation,
    amountPaise: paiseToJson(allocation.amountPaise),
    ...(charge
      ? { charge: { ...charge, amountPaise: paiseToJson(charge.amountPaise) } }
      : {}),
  })),
});

const paymentDetails = async (
  transaction: Prisma.TransactionClient,
  centerId: string,
  paymentId: string,
) => {
  const payment = await transaction.payment.findFirst({
    where: { id: paymentId, centerId },
    include: {
      student: { select: { id: true, name: true } },
      center: { select: { id: true, name: true } },
      allocations: {
        where: { centerId },
        orderBy: { charge: { dueDate: "asc" } },
        include: {
          charge: {
            select: {
              id: true,
              description: true,
              dueDate: true,
              amountPaise: true,
            },
          },
        },
      },
    },
  });
  if (!payment) {
    throw new AppError(404, "NOT_FOUND", "Payment not found");
  }
  return serializePayment(payment);
};

const paymentByIdempotencyKey = async (
  transaction: Prisma.TransactionClient,
  centerId: string,
  idempotencyKey: string,
) =>
  transaction.payment.findFirst({
    where: { centerId, idempotencyKey },
    select: { id: true },
  });

const lockedChargeIds = async (
  transaction: Prisma.TransactionClient,
  centerId: string,
  chargeIds: string[],
) => {
  if (chargeIds.length === 0) {
    return [];
  }
  const ids = Prisma.join(
    [...new Set(chargeIds)].sort().map((chargeId) => Prisma.sql`${chargeId}::uuid`),
  );
  const rows = await transaction.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "FeeCharge"
    WHERE "centerId" = ${centerId}::uuid AND "id" IN (${ids})
    ORDER BY "id"
    FOR UPDATE
  `;
  return rows.map(({ id }) => id);
};

const outstandingByCharge = async (
  transaction: Prisma.TransactionClient,
  centerId: string,
  chargeIds: string[],
): Promise<Map<string, bigint>> => {
  if (chargeIds.length === 0) {
    return new Map();
  }
  const ids = Prisma.join(
    [...new Set(chargeIds)].sort().map((chargeId) => Prisma.sql`${chargeId}::uuid`),
  );
  const rows = await transaction.$queryRaw<
    Array<{ chargeId: string; paidPaise: bigint }>
  >`
    SELECT a."chargeId" AS "chargeId",
           COALESCE(SUM(a."amountPaise") FILTER (WHERE p."voidedAt" IS NULL), 0)::bigint AS "paidPaise"
    FROM "PaymentAllocation" a
    JOIN "Payment" p
      ON p."centerId" = a."centerId" AND p."id" = a."paymentId"
    WHERE a."centerId" = ${centerId}::uuid
      AND a."chargeId" IN (${ids})
    GROUP BY a."chargeId"
  `;
  const paidByCharge = new Map(
    rows.map(({ chargeId, paidPaise }) => [chargeId, paidPaise]),
  );
  const charges = await transaction.feeCharge.findMany({
    where: { centerId, id: { in: chargeIds } },
    select: { id: true, amountPaise: true },
  });
  return new Map(
    charges.map(({ id, amountPaise }) => [
      id,
      amountPaise - (paidByCharge.get(id) ?? 0n),
    ]),
  );
};

const nextReceiptNumber = async (
  transaction: Prisma.TransactionClient,
  centerId: string,
): Promise<string> => {
  const rows = await transaction.$queryRaw<Array<{ value: bigint }>>`
    INSERT INTO "CenterCounter" ("centerId", "name", "value")
    VALUES (${centerId}::uuid, 'receipt', 1)
    ON CONFLICT ("centerId", "name")
    DO UPDATE SET "value" = "CenterCounter"."value" + 1
    RETURNING "value"
  `;
  const value = rows[0]?.value;
  if (value === undefined) {
    throw new Error("Receipt counter did not return its incremented value");
  }
  return `R-${value.toString().padStart(6, "0")}`;
};

const sumAllocationAmounts = (
  allocations: Array<{ amountPaise: string }>,
): bigint =>
  allocations.reduce(
    (total, allocation) => total + parsePaise(allocation.amountPaise),
    0n,
  );

const explicitAllocations = async (
  transaction: Prisma.TransactionClient,
  centerId: string,
  studentId: string,
  input: NonNullable<CreatePaymentInput["allocations"]>,
  paymentAmount: bigint,
) => {
  const total = sumAllocationAmounts(input);
  if (total !== paymentAmount) {
    throw new AppError(
      422,
      "ALLOCATION_TOTAL_MISMATCH",
      "Allocation amounts must add up exactly to the payment amount",
    );
  }

  const requestedIds = input.map(({ chargeId }) => chargeId);
  const lockedIds = await lockedChargeIds(transaction, centerId, requestedIds);
  if (lockedIds.length !== new Set(requestedIds).size) {
    throw new AppError(404, "NOT_FOUND", "Fee charge not found");
  }
  const charges = await transaction.feeCharge.findMany({
    where: { centerId, id: { in: lockedIds } },
    select: { id: true, studentId: true, amountPaise: true, waivedAt: true },
  });
  const chargesById = new Map(charges.map((charge) => [charge.id, charge]));
  for (const chargeId of requestedIds) {
    const charge = chargesById.get(chargeId);
    if (!charge) {
      throw new AppError(404, "NOT_FOUND", "Fee charge not found");
    }
    if (charge.studentId !== studentId) {
      throw new AppError(
        422,
        "ALLOCATION_STUDENT_MISMATCH",
        "Every allocated charge must belong to the payment's student",
      );
    }
    if (charge.waivedAt) {
      throw new AppError(409, "CHARGE_WAIVED", "A waived charge cannot be paid");
    }
  }

  const outstanding = await outstandingByCharge(transaction, centerId, requestedIds);
  for (const allocation of input) {
    const remaining = outstanding.get(allocation.chargeId);
    if (remaining === undefined) {
      throw new AppError(404, "NOT_FOUND", "Fee charge not found");
    }
    if (parsePaise(allocation.amountPaise) > remaining) {
      throw new AppError(
        422,
        "ALLOCATION_EXCEEDS_OUTSTANDING",
        "An allocation cannot exceed the charge's outstanding amount",
      );
    }
  }

  return input.map(({ chargeId, amountPaise }) => ({
    centerId,
    chargeId,
    amountPaise: parsePaise(amountPaise),
  }));
};

const automaticAllocations = async (
  transaction: Prisma.TransactionClient,
  centerId: string,
  studentId: string,
  paymentAmount: bigint,
) => {
  const lockedRows = await transaction.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "FeeCharge"
    WHERE "centerId" = ${centerId}::uuid
      AND "studentId" = ${studentId}::uuid
      AND "waivedAt" IS NULL
    ORDER BY "id"
    FOR UPDATE
  `;
  const charges = await transaction.feeCharge.findMany({
    where: {
      centerId,
      studentId,
      id: { in: lockedRows.map(({ id }) => id) },
      waivedAt: null,
    },
    orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    select: { id: true, amountPaise: true },
  });
  const outstanding = await outstandingByCharge(
    transaction,
    centerId,
    charges.map(({ id }) => id),
  );
  const totalOutstanding = charges.reduce(
    (total, charge) => total + (outstanding.get(charge.id) ?? 0n),
    0n,
  );
  if (paymentAmount > totalOutstanding) {
    throw new AppError(
      422,
      "PAYMENT_EXCEEDS_OUTSTANDING",
      `Payment exceeds the outstanding amount of ${paiseToJson(totalOutstanding)} paise; advance payments are not supported`,
    );
  }

  let remaining = paymentAmount;
  const allocations: Array<{
    centerId: string;
    chargeId: string;
    amountPaise: bigint;
  }> = [];
  for (const charge of charges) {
    if (remaining === 0n) {
      break;
    }
    const due = outstanding.get(charge.id) ?? 0n;
    if (due <= 0n) {
      continue;
    }
    const amountPaise = due < remaining ? due : remaining;
    allocations.push({ centerId, chargeId: charge.id, amountPaise });
    remaining -= amountPaise;
  }
  return allocations;
};

export const createPayment = async (
  centerId: string,
  recordedByUserId: string,
  input: CreatePaymentInput,
  idempotencyKey?: string,
) => {
  if (input.paidOn > todayInBusinessTimeZone()) {
    throw new AppError(400, "VALIDATION_ERROR", "paidOn cannot be in the future");
  }
  const amountPaise = parsePaise(input.amountPaise);

  try {
    return await withTenant(centerId, async (transaction) => {
      if (idempotencyKey) {
        const existing = await paymentByIdempotencyKey(
          transaction,
          centerId,
          idempotencyKey,
        );
        if (existing) {
          return {
            payment: await paymentDetails(transaction, centerId, existing.id),
            replayed: true,
          };
        }
      }

      const student = await transaction.student.findFirst({
        where: { id: input.studentId, centerId },
        select: { id: true },
      });
      if (!student) {
        throw new AppError(404, "NOT_FOUND", "Student not found");
      }
      await transaction.$queryRaw`
        SELECT "id" FROM "Student"
        WHERE "id" = ${input.studentId}::uuid AND "centerId" = ${centerId}::uuid
        FOR UPDATE
      `;

      if (idempotencyKey) {
        const existing = await paymentByIdempotencyKey(
          transaction,
          centerId,
          idempotencyKey,
        );
        if (existing) {
          return {
            payment: await paymentDetails(transaction, centerId, existing.id),
            replayed: true,
          };
        }
      }

      const allocations =
        input.allocations === undefined
          ? await automaticAllocations(
              transaction,
              centerId,
              input.studentId,
              amountPaise,
            )
          : await explicitAllocations(
              transaction,
              centerId,
              input.studentId,
              input.allocations,
              amountPaise,
            );
      if (allocations.length === 0) {
        throw new AppError(
          422,
          "NO_OUTSTANDING_CHARGES",
          "The student has no outstanding charges for this payment",
        );
      }

      const receiptNumber = await nextReceiptNumber(transaction, centerId);
      const payment = await transaction.payment.create({
        data: {
          center: { connect: { id: centerId } },
          student: {
            connect: {
              centerId_id: { centerId, id: input.studentId },
            },
          },
          amountPaise,
          paidOn: calendarDateToUtc(input.paidOn),
          method: input.method,
          reference: input.reference || null,
          receiptNumber,
          idempotencyKey: idempotencyKey ?? null,
          recordedBy: { connect: { id: recordedByUserId } },
          allocations: {
            create: allocations.map(({ chargeId, amountPaise }) => ({
              amountPaise,
              center: { connect: { id: centerId } },
              charge: {
                connect: {
                  centerId_id: { centerId, id: chargeId },
                },
              },
            })),
          },
        },
        select: { id: true },
      });
      await recordAudit(transaction, {
        centerId,
        actorUserId: recordedByUserId,
        action: "payment.recorded",
        entityType: "Payment",
        entityId: payment.id,
        metadata: {
          amountPaise: amountPaise.toString(),
          allocationCount: allocations.length,
          changedFields: ["amountPaise", "paidOn", "method", "allocations"],
        },
      });
      return {
        payment: await paymentDetails(transaction, centerId, payment.id),
        replayed: false,
      };
    });
  } catch (error) {
    if (
      idempotencyKey &&
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const replay = await withTenant(centerId, async (transaction) => {
        const existing = await paymentByIdempotencyKey(
          transaction,
          centerId,
          idempotencyKey,
        );
        return existing
          ? paymentDetails(transaction, centerId, existing.id)
          : undefined;
      });
      if (replay) {
        return { payment: replay, replayed: true };
      }
    }
    throw error;
  }
};

export const listPayments = (centerId: string, filters: PaymentListQuery) =>
  withTenant(centerId, async (transaction) => {
    const where = {
      centerId,
      ...(filters.studentId ? { studentId: filters.studentId } : {}),
      ...(filters.method ? { method: filters.method } : {}),
      ...(filters.from || filters.to
        ? {
            paidOn: {
              ...(filters.from
                ? { gte: calendarDateToUtc(filters.from) }
                : {}),
              ...(filters.to ? { lte: calendarDateToUtc(filters.to) } : {}),
            },
          }
        : {}),
      ...(filters.includeVoided ? {} : { voidedAt: null }),
    };
    const [payments, total] = await Promise.all([
      transaction.payment.findMany({
        where,
        orderBy: [{ paidOn: "desc" }, { createdAt: "desc" }, { id: "desc" }],
        take: filters.limit,
        skip: filters.offset,
        include: {
          student: { select: { id: true, name: true } },
          allocations: {
            where: { centerId },
            select: { id: true, chargeId: true, amountPaise: true },
          },
        },
      }),
      transaction.payment.count({ where }),
    ]);
    return {
      payments: payments.map(serializePayment),
      total,
      limit: filters.limit,
      offset: filters.offset,
    };
  });

export const getPayment = (centerId: string, paymentId: string) =>
  withTenant(centerId, (transaction) =>
    paymentDetails(transaction, centerId, paymentId),
  );

export const voidPayment = async (
  centerId: string,
  userId: string,
  paymentId: string,
  reason: string,
) =>
  withTenant(centerId, async (transaction) => {
    const payment = await transaction.payment.findFirst({
      where: { id: paymentId, centerId },
      select: {
        id: true,
        studentId: true,
        voidedAt: true,
        allocations: { select: { chargeId: true } },
      },
    });
    if (!payment) {
      throw new AppError(404, "NOT_FOUND", "Payment not found");
    }
    await transaction.$queryRaw`
      SELECT "id" FROM "Student"
      WHERE "id" = ${payment.studentId}::uuid AND "centerId" = ${centerId}::uuid
      FOR UPDATE
    `;
    const chargeIds = payment.allocations.map(({ chargeId }) => chargeId);
    const lockedIds = await lockedChargeIds(transaction, centerId, chargeIds);
    if (lockedIds.length !== new Set(chargeIds).size) {
      throw new AppError(404, "NOT_FOUND", "Payment not found");
    }
    await transaction.$queryRaw`
      SELECT "id" FROM "Payment"
      WHERE "id" = ${paymentId}::uuid AND "centerId" = ${centerId}::uuid
      FOR UPDATE
    `;
    const current = await transaction.payment.findFirst({
      where: { id: paymentId, centerId },
      select: { voidedAt: true },
    });
    if (!current) {
      throw new AppError(404, "NOT_FOUND", "Payment not found");
    }
    if (current.voidedAt) {
      throw new AppError(409, "PAYMENT_ALREADY_VOIDED", "Payment is already voided");
    }
    const updated = await transaction.payment.updateMany({
      where: { id: paymentId, centerId, voidedAt: null },
      data: {
        voidedAt: new Date(),
        voidedByUserId: userId,
        voidReason: reason,
      },
    });
    if (updated.count === 0) {
      throw new AppError(409, "PAYMENT_ALREADY_VOIDED", "Payment is already voided");
    }
    await recordAudit(transaction, {
      centerId,
      actorUserId: userId,
      action: "payment.voided",
      entityType: "Payment",
      entityId: paymentId,
      metadata: { changedFields: ["voidedAt", "voidedByUserId"] },
    });
    return paymentDetails(transaction, centerId, paymentId);
  });
