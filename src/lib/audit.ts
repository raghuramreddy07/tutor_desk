import type { Prisma, Role } from "@prisma/client";
import { getRequestContext } from "./requestContext";

const forbiddenMetadataKey =
  /password|token|jwt|secret|email|phone|name|personal|idempotency|cookie|authorization|reason/i;

export type AuditEntry = {
  centerId: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  actorUserId?: string | null;
  actorRole?: Role | null;
  metadata?: Prisma.InputJsonObject;
  requestId?: string | null;
  ip?: string | null;
};

const assertSafeMetadata = (metadata: Prisma.InputJsonObject): void => {
  for (const [key, value] of Object.entries(metadata)) {
    if (forbiddenMetadataKey.test(key)) {
      throw new Error(`Sensitive audit metadata key is forbidden: ${key}`);
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      assertSafeMetadata(value as Prisma.InputJsonObject);
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === "object" && !Array.isArray(item)) {
          assertSafeMetadata(item as Prisma.InputJsonObject);
        }
      }
    }
  }
};

export const recordAudit = (
  transaction: Prisma.TransactionClient,
  entry: AuditEntry,
) => {
  const context = getRequestContext();
  const metadata = entry.metadata ?? {};
  assertSafeMetadata(metadata);

  return transaction.auditLog.create({
    data: {
      centerId: entry.centerId,
      actorUserId: entry.actorUserId ?? context?.userId ?? null,
      actorRole: entry.actorRole ?? context?.role ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      metadata,
      requestId: entry.requestId ?? context?.requestId ?? null,
      ip: entry.ip ?? context?.ip ?? null,
    },
  });
};
