-- CreateEnum
CREATE TYPE "FindingStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');

-- AlterTable
ALTER TABLE "FindingRecord" ADD COLUMN     "note" TEXT,
ADD COLUMN     "status" "FindingStatus" NOT NULL DEFAULT 'OPEN',
ADD COLUMN     "statusChangedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "FindingRecord_status_idx" ON "FindingRecord"("status");

