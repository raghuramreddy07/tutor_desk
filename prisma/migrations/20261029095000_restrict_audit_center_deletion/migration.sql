ALTER TABLE "AuditLog"
    DROP CONSTRAINT "AuditLog_centerId_fkey";

ALTER TABLE "AuditLog"
    ADD CONSTRAINT "AuditLog_centerId_fkey"
    FOREIGN KEY ("centerId") REFERENCES "Center"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
