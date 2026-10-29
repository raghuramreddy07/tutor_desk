CREATE TYPE "NotificationType" AS ENUM ('FEE_REMINDER');
CREATE TYPE "NotificationChannel" AS ENUM ('LOG');
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

CREATE TABLE "Notification" (
    "id" UUID NOT NULL,
    "centerId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "parentUserId" UUID,
    "type" "NotificationType" NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "payload" JSONB NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "error" TEXT,
    "skippedReason" TEXT,
    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Notification_centerId_fkey"
        FOREIGN KEY ("centerId") REFERENCES "Center"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Notification_centerId_studentId_fkey"
        FOREIGN KEY ("centerId", "studentId") REFERENCES "Student"("centerId", "id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Notification_parentUserId_fkey"
        FOREIGN KEY ("parentUserId") REFERENCES "User"("id")
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Notification_skip_state_check"
        CHECK (
            ("status" = 'SKIPPED' AND "skippedReason" IS NOT NULL AND "error" IS NULL)
            OR ("status" <> 'SKIPPED' AND "skippedReason" IS NULL)
        )
);
CREATE UNIQUE INDEX "Notification_centerId_id_key"
    ON "Notification"("centerId", "id");
CREATE UNIQUE INDEX "Notification_centerId_dedupeKey_key"
    ON "Notification"("centerId", "dedupeKey");
CREATE INDEX "Notification_centerId_idx" ON "Notification"("centerId");
CREATE INDEX "Notification_centerId_status_createdAt_idx"
    ON "Notification"("centerId", "status", "createdAt");
CREATE INDEX "Notification_centerId_studentId_idx"
    ON "Notification"("centerId", "studentId");

ALTER TABLE "Notification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Notification" FORCE ROW LEVEL SECURITY;
CREATE POLICY "Notification_center_isolation" ON "Notification" FOR ALL
USING ("centerId"::text = NULLIF(current_setting('app.current_center', true), ''))
WITH CHECK ("centerId"::text = NULLIF(current_setting('app.current_center', true), ''));

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "Notification" TO tutordesk_app;

CREATE OR REPLACE FUNCTION public.list_center_ids()
RETURNS TABLE ("id" UUID)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
    SELECT center."id"
    FROM public."Center" AS center
    ORDER BY center."id"
$function$;

REVOKE ALL ON FUNCTION public.list_center_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_center_ids() TO tutordesk_app;
