CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "centerId" UUID NOT NULL,
    "actorUserId" UUID,
    "actorRole" "Role",
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "metadata" JSONB NOT NULL,
    "requestId" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AuditLog_centerId_fkey"
        FOREIGN KEY ("centerId") REFERENCES "Center"("id")
        ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "AuditLog_centerId_createdAt_idx"
    ON "AuditLog"("centerId", "createdAt");
CREATE INDEX "AuditLog_centerId_action_createdAt_idx"
    ON "AuditLog"("centerId", "action", "createdAt");
CREATE INDEX "AuditLog_centerId_entityType_entityId_createdAt_idx"
    ON "AuditLog"("centerId", "entityType", "entityId", "createdAt");
CREATE INDEX "AuditLog_centerId_actorUserId_createdAt_idx"
    ON "AuditLog"("centerId", "actorUserId", "createdAt");

ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" FORCE ROW LEVEL SECURITY;
CREATE POLICY "AuditLog_center_isolation" ON "AuditLog" FOR ALL
USING ("centerId"::text = NULLIF(current_setting('app.current_center', true), ''))
WITH CHECK ("centerId"::text = NULLIF(current_setting('app.current_center', true), ''));

REVOKE ALL ON TABLE "AuditLog" FROM tutordesk_app;
GRANT SELECT, INSERT ON TABLE "AuditLog" TO tutordesk_app;
