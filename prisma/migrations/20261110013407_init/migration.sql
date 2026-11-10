-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('PENDING', 'PAYMENT_PENDING', 'CONFIRMED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('SUCCESS', 'INCONCLUSIVE', 'FAILED');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "bookingStatus" "BookingStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "providerPaymentId" TEXT NOT NULL,
    "orderReference" TEXT,
    "type" TEXT NOT NULL,
    "signatureValid" BOOLEAN NOT NULL,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationRun" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "status" "RunStatus" NOT NULL,
    "providerAvailable" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,

    CONSTRAINT "ReconciliationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FindingRecord" (
    "id" TEXT NOT NULL,
    "findingKey" TEXT NOT NULL,
    "mismatchClass" TEXT NOT NULL,
    "orderReference" TEXT,
    "providerPaymentId" TEXT,
    "currency" TEXT,
    "amountMinor" INTEGER,
    "firstSeenRunId" TEXT NOT NULL,
    "lastSeenRunId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FindingRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FindingOccurrence" (
    "id" TEXT NOT NULL,
    "findingRecordId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "severity" "Severity" NOT NULL,
    "evidence" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FindingOccurrence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Order_reference_key" ON "Order"("reference");

-- CreateIndex
CREATE INDEX "Order_bookingStatus_idx" ON "Order"("bookingStatus");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_eventId_key" ON "WebhookEvent"("eventId");

-- CreateIndex
CREATE INDEX "WebhookEvent_providerPaymentId_idx" ON "WebhookEvent"("providerPaymentId");

-- CreateIndex
CREATE INDEX "WebhookEvent_orderReference_idx" ON "WebhookEvent"("orderReference");

-- CreateIndex
CREATE UNIQUE INDEX "FindingRecord_findingKey_key" ON "FindingRecord"("findingKey");

-- CreateIndex
CREATE INDEX "FindingRecord_mismatchClass_idx" ON "FindingRecord"("mismatchClass");

-- CreateIndex
CREATE INDEX "FindingRecord_orderReference_idx" ON "FindingRecord"("orderReference");

-- CreateIndex
CREATE INDEX "FindingOccurrence_runId_idx" ON "FindingOccurrence"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "FindingOccurrence_findingRecordId_runId_key" ON "FindingOccurrence"("findingRecordId", "runId");

-- AddForeignKey
ALTER TABLE "FindingOccurrence" ADD CONSTRAINT "FindingOccurrence_findingRecordId_fkey" FOREIGN KEY ("findingRecordId") REFERENCES "FindingRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FindingOccurrence" ADD CONSTRAINT "FindingOccurrence_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ReconciliationRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

