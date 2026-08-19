-- AlterTable
ALTER TABLE "Transcript" ALTER COLUMN "summaryEmbedding" SET DEFAULT ARRAY[]::DOUBLE PRECISION[],
ALTER COLUMN "followUpsRedacted" SET DEFAULT ARRAY[]::TEXT[];
