CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'LATE');

ALTER TABLE "Membership"
    ADD CONSTRAINT "Membership_centerId_userId_key" UNIQUE ("centerId", "userId");

CREATE TABLE "Batch" (
    "id" UUID NOT NULL,
    "centerId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT,
    "schedule" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Batch_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Batch_centerId_fkey"
        FOREIGN KEY ("centerId") REFERENCES "Center"("id")
        ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Batch_centerId_id_key" ON "Batch"("centerId", "id");
CREATE INDEX "Batch_centerId_idx" ON "Batch"("centerId");

CREATE TABLE "BatchTeacher" (
    "id" UUID NOT NULL,
    "centerId" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BatchTeacher_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "BatchTeacher_centerId_batchId_fkey"
        FOREIGN KEY ("centerId", "batchId") REFERENCES "Batch"("centerId", "id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BatchTeacher_centerId_userId_fkey"
        FOREIGN KEY ("centerId", "userId") REFERENCES "Membership"("centerId", "userId")
        ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "BatchTeacher_batchId_userId_key" ON "BatchTeacher"("batchId", "userId");
CREATE INDEX "BatchTeacher_centerId_idx" ON "BatchTeacher"("centerId");
CREATE INDEX "BatchTeacher_centerId_userId_idx" ON "BatchTeacher"("centerId", "userId");

CREATE TABLE "BatchStudent" (
    "id" UUID NOT NULL,
    "centerId" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BatchStudent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "BatchStudent_centerId_batchId_fkey"
        FOREIGN KEY ("centerId", "batchId") REFERENCES "Batch"("centerId", "id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BatchStudent_centerId_studentId_fkey"
        FOREIGN KEY ("centerId", "studentId") REFERENCES "Student"("centerId", "id")
        ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "BatchStudent_batchId_studentId_key" ON "BatchStudent"("batchId", "studentId");
CREATE UNIQUE INDEX "BatchStudent_centerId_batchId_studentId_key"
    ON "BatchStudent"("centerId", "batchId", "studentId");
CREATE INDEX "BatchStudent_centerId_idx" ON "BatchStudent"("centerId");
CREATE INDEX "BatchStudent_centerId_studentId_idx" ON "BatchStudent"("centerId", "studentId");

CREATE TABLE "Attendance" (
    "id" UUID NOT NULL,
    "centerId" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "markedByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Attendance_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Attendance_centerId_batchId_studentId_fkey"
        FOREIGN KEY ("centerId", "batchId", "studentId")
        REFERENCES "BatchStudent"("centerId", "batchId", "studentId")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Attendance_markedByUserId_fkey"
        FOREIGN KEY ("markedByUserId") REFERENCES "User"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Attendance_batchId_studentId_date_key"
    ON "Attendance"("batchId", "studentId", "date");
CREATE INDEX "Attendance_centerId_idx" ON "Attendance"("centerId");
CREATE INDEX "Attendance_centerId_batchId_date_idx"
    ON "Attendance"("centerId", "batchId", "date");
CREATE INDEX "Attendance_centerId_studentId_date_idx"
    ON "Attendance"("centerId", "studentId", "date");

CREATE TABLE "Exam" (
    "id" UUID NOT NULL,
    "centerId" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "maxMarks" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Exam_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Exam_maxMarks_positive_check" CHECK ("maxMarks" > 0),
    CONSTRAINT "Exam_centerId_batchId_fkey"
        FOREIGN KEY ("centerId", "batchId") REFERENCES "Batch"("centerId", "id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Exam_centerId_id_key" ON "Exam"("centerId", "id");
CREATE INDEX "Exam_centerId_idx" ON "Exam"("centerId");
CREATE INDEX "Exam_centerId_batchId_date_idx" ON "Exam"("centerId", "batchId", "date");

CREATE TABLE "ExamResult" (
    "id" UUID NOT NULL,
    "centerId" UUID NOT NULL,
    "examId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "marks" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ExamResult_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ExamResult_marks_nonnegative_check" CHECK ("marks" >= 0),
    CONSTRAINT "ExamResult_centerId_examId_fkey"
        FOREIGN KEY ("centerId", "examId") REFERENCES "Exam"("centerId", "id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ExamResult_centerId_studentId_fkey"
        FOREIGN KEY ("centerId", "studentId") REFERENCES "Student"("centerId", "id")
        ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ExamResult_examId_studentId_key" ON "ExamResult"("examId", "studentId");
CREATE INDEX "ExamResult_centerId_idx" ON "ExamResult"("centerId");
CREATE INDEX "ExamResult_centerId_studentId_idx" ON "ExamResult"("centerId", "studentId");

ALTER TABLE "Batch" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Batch" FORCE ROW LEVEL SECURITY;
CREATE POLICY "Batch_center_isolation" ON "Batch" FOR ALL
USING ("centerId"::text = NULLIF(current_setting('app.current_center', true), ''))
WITH CHECK ("centerId"::text = NULLIF(current_setting('app.current_center', true), ''));

ALTER TABLE "BatchTeacher" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BatchTeacher" FORCE ROW LEVEL SECURITY;
CREATE POLICY "BatchTeacher_center_isolation" ON "BatchTeacher" FOR ALL
USING ("centerId"::text = NULLIF(current_setting('app.current_center', true), ''))
WITH CHECK ("centerId"::text = NULLIF(current_setting('app.current_center', true), ''));

ALTER TABLE "BatchStudent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BatchStudent" FORCE ROW LEVEL SECURITY;
CREATE POLICY "BatchStudent_center_isolation" ON "BatchStudent" FOR ALL
USING ("centerId"::text = NULLIF(current_setting('app.current_center', true), ''))
WITH CHECK ("centerId"::text = NULLIF(current_setting('app.current_center', true), ''));

ALTER TABLE "Attendance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Attendance" FORCE ROW LEVEL SECURITY;
CREATE POLICY "Attendance_center_isolation" ON "Attendance" FOR ALL
USING ("centerId"::text = NULLIF(current_setting('app.current_center', true), ''))
WITH CHECK ("centerId"::text = NULLIF(current_setting('app.current_center', true), ''));

ALTER TABLE "Exam" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Exam" FORCE ROW LEVEL SECURITY;
CREATE POLICY "Exam_center_isolation" ON "Exam" FOR ALL
USING ("centerId"::text = NULLIF(current_setting('app.current_center', true), ''))
WITH CHECK ("centerId"::text = NULLIF(current_setting('app.current_center', true), ''));

ALTER TABLE "ExamResult" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ExamResult" FORCE ROW LEVEL SECURITY;
CREATE POLICY "ExamResult_center_isolation" ON "ExamResult" FOR ALL
USING ("centerId"::text = NULLIF(current_setting('app.current_center', true), ''))
WITH CHECK ("centerId"::text = NULLIF(current_setting('app.current_center', true), ''));

GRANT SELECT, INSERT, UPDATE, DELETE
ON TABLE "Batch", "BatchTeacher", "BatchStudent", "Attendance", "Exam", "ExamResult"
TO tutordesk_app;
