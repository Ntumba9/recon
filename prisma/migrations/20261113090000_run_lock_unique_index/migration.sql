-- Ensures at most one ReconciliationRun can be "in progress" (finishedAt
-- IS NULL) at a time. Indexing the constant expression (true) means every
-- row matching the partial WHERE clause shares the same indexed value, so
-- a second such row collides with the unique constraint - the database
-- itself rejects a second concurrent run, rather than the application
-- racing a SELECT against an INSERT to decide the same thing.
CREATE UNIQUE INDEX "ReconciliationRun_single_in_progress" ON "ReconciliationRun" ((true)) WHERE "finishedAt" IS NULL;
