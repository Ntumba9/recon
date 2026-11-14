-- CreateEnum
CREATE TYPE "HistoryChangeSource" AS ENUM ('MANUAL', 'RECONCILIATION');

-- CreateEnum
CREATE TYPE "NoteChangeType" AS ENUM ('UNCHANGED', 'SET', 'CLEARED');

-- AlterTable
ALTER TABLE "FindingRecord" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "FindingHistoryEntry" (
    "id" TEXT NOT NULL,
    "findingRecordId" TEXT NOT NULL,
    "previousStatus" "FindingStatus" NOT NULL,
    "newStatus" "FindingStatus" NOT NULL,
    "changeSource" "HistoryChangeSource" NOT NULL,
    "noteChangeType" "NoteChangeType" NOT NULL,
    "newNote" TEXT,
    "sourceRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sequence" SERIAL NOT NULL,

    CONSTRAINT "FindingHistoryEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FindingHistoryEntry_findingRecordId_sequence_idx" ON "FindingHistoryEntry"("findingRecordId", "sequence");

-- AddForeignKey
ALTER TABLE "FindingHistoryEntry" ADD CONSTRAINT "FindingHistoryEntry_findingRecordId_fkey" FOREIGN KEY ("findingRecordId") REFERENCES "FindingRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FindingHistoryEntry" ADD CONSTRAINT "FindingHistoryEntry_sourceRunId_fkey" FOREIGN KEY ("sourceRunId") REFERENCES "ReconciliationRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

