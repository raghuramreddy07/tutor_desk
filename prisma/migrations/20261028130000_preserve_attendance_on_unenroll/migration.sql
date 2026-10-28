ALTER TABLE "Attendance"
    DROP CONSTRAINT "Attendance_centerId_batchId_studentId_fkey";

ALTER TABLE "Attendance"
    ADD CONSTRAINT "Attendance_centerId_batchId_studentId_fkey"
    FOREIGN KEY ("centerId", "batchId", "studentId")
    REFERENCES "BatchStudent"("centerId", "batchId", "studentId")
    ON DELETE RESTRICT
    ON UPDATE CASCADE;
