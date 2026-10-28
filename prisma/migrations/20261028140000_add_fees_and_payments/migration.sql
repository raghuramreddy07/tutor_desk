CREATE TYPE "FeeFrequency" AS ENUM ('MONTHLY', 'ONE_TIME');
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'OTHER');

CREATE TABLE "FeePlan" (
    "id" UUID NOT NULL,
    "centerId" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "amountPaise" BIGINT NOT NULL,
    "frequency" "FeeFrequency" NOT NULL,
    "dueDay" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FeePlan_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "FeePlan_amountPaise_positive_check" CHECK ("amountPaise" > 0),
    CONSTRAINT "FeePlan_dueDay_frequency_check" CHECK (
        ("frequency" = 'MONTHLY' AND "dueDay" BETWEEN 1 AND 28)
        OR ("frequency" = 'ONE_TIME' AND "dueDay" IS NULL)
    ),
    CONSTRAINT "FeePlan_centerId_fkey"
        FOREIGN KEY ("centerId") REFERENCES "Center"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FeePlan_centerId_batchId_fkey"
        FOREIGN KEY ("centerId", "batchId") REFERENCES "Batch"("centerId", "id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "FeePlan_centerId_id_key" ON "FeePlan"("centerId", "id");
CREATE INDEX "FeePlan_centerId_idx" ON "FeePlan"("centerId");
CREATE INDEX "FeePlan_centerId_batchId_idx" ON "FeePlan"("centerId", "batchId");

CREATE TABLE "StudentFee" (
    "id" UUID NOT NULL,
    "centerId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "feePlanId" UUID NOT NULL,
    "customAmountPaise" BIGINT,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StudentFee_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "StudentFee_customAmountPaise_positive_check"
        CHECK ("customAmountPaise" IS NULL OR "customAmountPaise" > 0),
    CONSTRAINT "StudentFee_dates_check"
        CHECK ("endDate" IS NULL OR "endDate" >= "startDate"),
    CONSTRAINT "StudentFee_centerId_fkey"
        FOREIGN KEY ("centerId") REFERENCES "Center"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StudentFee_centerId_studentId_fkey"
        FOREIGN KEY ("centerId", "studentId") REFERENCES "Student"("centerId", "id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "StudentFee_centerId_feePlanId_fkey"
        FOREIGN KEY ("centerId", "feePlanId") REFERENCES "FeePlan"("centerId", "id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "StudentFee_centerId_id_key" ON "StudentFee"("centerId", "id");
CREATE UNIQUE INDEX "StudentFee_centerId_id_studentId_key"
    ON "StudentFee"("centerId", "id", "studentId");
CREATE INDEX "StudentFee_centerId_idx" ON "StudentFee"("centerId");
CREATE INDEX "StudentFee_centerId_studentId_idx" ON "StudentFee"("centerId", "studentId");
CREATE INDEX "StudentFee_centerId_feePlanId_idx" ON "StudentFee"("centerId", "feePlanId");

CREATE TABLE "FeeCharge" (
    "id" UUID NOT NULL,
    "centerId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "studentFeeId" UUID NOT NULL,
    "periodStart" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "amountPaise" BIGINT NOT NULL,
    "description" TEXT NOT NULL,
    "waivedAt" TIMESTAMP(3),
    "waivedByUserId" UUID,
    "waiveReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FeeCharge_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "FeeCharge_amountPaise_positive_check" CHECK ("amountPaise" > 0),
    CONSTRAINT "FeeCharge_waiver_fields_check" CHECK (
        ("waivedAt" IS NULL AND "waivedByUserId" IS NULL AND "waiveReason" IS NULL)
        OR ("waivedAt" IS NOT NULL AND "waivedByUserId" IS NOT NULL AND "waiveReason" IS NOT NULL)
    ),
    CONSTRAINT "FeeCharge_centerId_fkey"
        FOREIGN KEY ("centerId") REFERENCES "Center"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FeeCharge_centerId_studentFeeId_studentId_fkey"
        FOREIGN KEY ("centerId", "studentFeeId", "studentId")
        REFERENCES "StudentFee"("centerId", "id", "studentId")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FeeCharge_waivedByUserId_fkey"
        FOREIGN KEY ("waivedByUserId") REFERENCES "User"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "FeeCharge_centerId_id_key" ON "FeeCharge"("centerId", "id");
CREATE UNIQUE INDEX "FeeCharge_studentFeeId_periodStart_key"
    ON "FeeCharge"("studentFeeId", "periodStart");
CREATE INDEX "FeeCharge_centerId_idx" ON "FeeCharge"("centerId");
CREATE INDEX "FeeCharge_centerId_studentId_dueDate_idx"
    ON "FeeCharge"("centerId", "studentId", "dueDate");
CREATE INDEX "FeeCharge_centerId_dueDate_idx" ON "FeeCharge"("centerId", "dueDate");

CREATE TABLE "Payment" (
    "id" UUID NOT NULL,
    "centerId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "amountPaise" BIGINT NOT NULL,
    "paidOn" DATE NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reference" TEXT,
    "receiptNumber" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "recordedByUserId" UUID NOT NULL,
    "voidedAt" TIMESTAMP(3),
    "voidedByUserId" UUID,
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Payment_amountPaise_positive_check" CHECK ("amountPaise" > 0),
    CONSTRAINT "Payment_void_fields_check" CHECK (
        ("voidedAt" IS NULL AND "voidedByUserId" IS NULL AND "voidReason" IS NULL)
        OR ("voidedAt" IS NOT NULL AND "voidedByUserId" IS NOT NULL AND "voidReason" IS NOT NULL)
    ),
    CONSTRAINT "Payment_centerId_fkey"
        FOREIGN KEY ("centerId") REFERENCES "Center"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Payment_centerId_studentId_fkey"
        FOREIGN KEY ("centerId", "studentId") REFERENCES "Student"("centerId", "id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Payment_recordedByUserId_fkey"
        FOREIGN KEY ("recordedByUserId") REFERENCES "User"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Payment_voidedByUserId_fkey"
        FOREIGN KEY ("voidedByUserId") REFERENCES "User"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Payment_centerId_id_key" ON "Payment"("centerId", "id");
CREATE UNIQUE INDEX "Payment_centerId_receiptNumber_key"
    ON "Payment"("centerId", "receiptNumber");
CREATE UNIQUE INDEX "Payment_centerId_idempotencyKey_key"
    ON "Payment"("centerId", "idempotencyKey");
CREATE INDEX "Payment_centerId_idx" ON "Payment"("centerId");
CREATE INDEX "Payment_centerId_studentId_paidOn_idx" ON "Payment"("centerId", "studentId", "paidOn");
CREATE INDEX "Payment_centerId_paidOn_idx" ON "Payment"("centerId", "paidOn");

CREATE TABLE "PaymentAllocation" (
    "id" UUID NOT NULL,
    "centerId" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "chargeId" UUID NOT NULL,
    "amountPaise" BIGINT NOT NULL,
    CONSTRAINT "PaymentAllocation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PaymentAllocation_amountPaise_positive_check"
        CHECK ("amountPaise" > 0),
    CONSTRAINT "PaymentAllocation_centerId_fkey"
        FOREIGN KEY ("centerId") REFERENCES "Center"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PaymentAllocation_centerId_paymentId_fkey"
        FOREIGN KEY ("centerId", "paymentId") REFERENCES "Payment"("centerId", "id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PaymentAllocation_centerId_chargeId_fkey"
        FOREIGN KEY ("centerId", "chargeId") REFERENCES "FeeCharge"("centerId", "id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PaymentAllocation_centerId_paymentId_chargeId_key"
    ON "PaymentAllocation"("centerId", "paymentId", "chargeId");
CREATE INDEX "PaymentAllocation_centerId_idx" ON "PaymentAllocation"("centerId");
CREATE INDEX "PaymentAllocation_centerId_paymentId_idx"
    ON "PaymentAllocation"("centerId", "paymentId");
CREATE INDEX "PaymentAllocation_centerId_chargeId_idx"
    ON "PaymentAllocation"("centerId", "chargeId");

CREATE TABLE "CenterCounter" (
    "centerId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "value" BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT "CenterCounter_pkey" PRIMARY KEY ("centerId", "name"),
    CONSTRAINT "CenterCounter_value_nonnegative_check" CHECK ("value" >= 0),
    CONSTRAINT "CenterCounter_centerId_fkey"
        FOREIGN KEY ("centerId") REFERENCES "Center"("id")
        ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "CenterCounter_centerId_idx" ON "CenterCounter"("centerId");

ALTER TABLE "FeePlan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FeePlan" FORCE ROW LEVEL SECURITY;
CREATE POLICY "FeePlan_center_isolation" ON "FeePlan" FOR ALL
USING ("centerId"::text = NULLIF(current_setting('app.current_center', true), ''))
WITH CHECK ("centerId"::text = NULLIF(current_setting('app.current_center', true), ''));

ALTER TABLE "StudentFee" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StudentFee" FORCE ROW LEVEL SECURITY;
CREATE POLICY "StudentFee_center_isolation" ON "StudentFee" FOR ALL
USING ("centerId"::text = NULLIF(current_setting('app.current_center', true), ''))
WITH CHECK ("centerId"::text = NULLIF(current_setting('app.current_center', true), ''));

ALTER TABLE "FeeCharge" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FeeCharge" FORCE ROW LEVEL SECURITY;
CREATE POLICY "FeeCharge_center_isolation" ON "FeeCharge" FOR ALL
USING ("centerId"::text = NULLIF(current_setting('app.current_center', true), ''))
WITH CHECK ("centerId"::text = NULLIF(current_setting('app.current_center', true), ''));

ALTER TABLE "Payment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Payment" FORCE ROW LEVEL SECURITY;
CREATE POLICY "Payment_center_isolation" ON "Payment" FOR ALL
USING ("centerId"::text = NULLIF(current_setting('app.current_center', true), ''))
WITH CHECK ("centerId"::text = NULLIF(current_setting('app.current_center', true), ''));

ALTER TABLE "PaymentAllocation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PaymentAllocation" FORCE ROW LEVEL SECURITY;
CREATE POLICY "PaymentAllocation_center_isolation" ON "PaymentAllocation" FOR ALL
USING ("centerId"::text = NULLIF(current_setting('app.current_center', true), ''))
WITH CHECK ("centerId"::text = NULLIF(current_setting('app.current_center', true), ''));

ALTER TABLE "CenterCounter" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CenterCounter" FORCE ROW LEVEL SECURITY;
CREATE POLICY "CenterCounter_center_isolation" ON "CenterCounter" FOR ALL
USING ("centerId"::text = NULLIF(current_setting('app.current_center', true), ''))
WITH CHECK ("centerId"::text = NULLIF(current_setting('app.current_center', true), ''));

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "FeePlan", "StudentFee" TO tutordesk_app;
GRANT SELECT, INSERT, UPDATE ON TABLE "FeeCharge", "Payment" TO tutordesk_app;
GRANT SELECT, INSERT ON TABLE "PaymentAllocation" TO tutordesk_app;
GRANT SELECT, INSERT, UPDATE ON TABLE "CenterCounter" TO tutordesk_app;
