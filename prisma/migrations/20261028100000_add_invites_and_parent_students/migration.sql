CREATE TYPE "InviteRole" AS ENUM ('TEACHER', 'PARENT');

ALTER TABLE "Student"
    ADD CONSTRAINT "Student_centerId_id_key" UNIQUE ("centerId", "id");

CREATE TABLE "Invite" (
    "id" UUID NOT NULL,
    "centerId" UUID NOT NULL,
    "invitedByUserId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "role" "InviteRole" NOT NULL,
    "studentId" UUID,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Invite_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Invite_parent_requires_student_check"
        CHECK (
            ("role" = 'PARENT' AND "studentId" IS NOT NULL)
            OR ("role" = 'TEACHER' AND "studentId" IS NULL)
        )
);

CREATE TABLE "ParentStudent" (
    "id" UUID NOT NULL,
    "centerId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ParentStudent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Invite_tokenHash_key" ON "Invite"("tokenHash");
CREATE INDEX "Invite_centerId_idx" ON "Invite"("centerId");
CREATE UNIQUE INDEX "Invite_pending_center_email_role_key"
    ON "Invite"("centerId", LOWER("email"), "role")
    WHERE "acceptedAt" IS NULL AND "revokedAt" IS NULL;

CREATE UNIQUE INDEX "ParentStudent_userId_studentId_key"
    ON "ParentStudent"("userId", "studentId");
CREATE INDEX "ParentStudent_centerId_idx" ON "ParentStudent"("centerId");

ALTER TABLE "Invite" ADD CONSTRAINT "Invite_centerId_fkey"
    FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_invitedByUserId_fkey"
    FOREIGN KEY ("invitedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_centerId_studentId_fkey"
    FOREIGN KEY ("centerId", "studentId")
    REFERENCES "Student"("centerId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ParentStudent" ADD CONSTRAINT "ParentStudent_centerId_fkey"
    FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ParentStudent" ADD CONSTRAINT "ParentStudent_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ParentStudent" ADD CONSTRAINT "ParentStudent_centerId_studentId_fkey"
    FOREIGN KEY ("centerId", "studentId")
    REFERENCES "Student"("centerId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Invite" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Invite" FORCE ROW LEVEL SECURITY;
CREATE POLICY "Invite_center_isolation"
ON "Invite"
FOR ALL
USING (
    "centerId"::text = NULLIF(current_setting('app.current_center', true), '')
)
WITH CHECK (
    "centerId"::text = NULLIF(current_setting('app.current_center', true), '')
);
CREATE POLICY "Invite_token_lookup"
ON "Invite"
FOR SELECT
USING (
    "tokenHash" = NULLIF(current_setting('app.invite_token_hash', true), '')
);

ALTER TABLE "ParentStudent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ParentStudent" FORCE ROW LEVEL SECURITY;
CREATE POLICY "ParentStudent_center_isolation"
ON "ParentStudent"
FOR ALL
USING (
    "centerId"::text = NULLIF(current_setting('app.current_center', true), '')
)
WITH CHECK (
    "centerId"::text = NULLIF(current_setting('app.current_center', true), '')
);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "Invite", "ParentStudent" TO tutordesk_app;
