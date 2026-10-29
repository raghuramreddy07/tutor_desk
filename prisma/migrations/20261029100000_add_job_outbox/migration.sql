CREATE TYPE "JobOutboxStatus" AS ENUM ('PENDING', 'DISPATCHING', 'DISPATCHED');

CREATE TABLE "JobOutbox" (
    "id" UUID NOT NULL,
    "centerId" UUID NOT NULL,
    "month" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "status" "JobOutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "dispatchedAt" TIMESTAMP(3),
    CONSTRAINT "JobOutbox_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "JobOutbox_centerId_fkey"
        FOREIGN KEY ("centerId") REFERENCES "Center"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "JobOutbox_centerId_id_key"
    ON "JobOutbox"("centerId", "id");
CREATE INDEX "JobOutbox_centerId_idx" ON "JobOutbox"("centerId");
CREATE INDEX "JobOutbox_centerId_status_createdAt_idx"
    ON "JobOutbox"("centerId", "status", "createdAt");

ALTER TABLE "JobOutbox" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "JobOutbox" FORCE ROW LEVEL SECURITY;
CREATE POLICY "JobOutbox_center_isolation" ON "JobOutbox" FOR ALL
USING ("centerId"::text = NULLIF(current_setting('app.current_center', true), ''))
WITH CHECK ("centerId"::text = NULLIF(current_setting('app.current_center', true), ''));

REVOKE ALL ON TABLE "JobOutbox" FROM tutordesk_app;
GRANT SELECT, INSERT, UPDATE ON TABLE "JobOutbox" TO tutordesk_app;
