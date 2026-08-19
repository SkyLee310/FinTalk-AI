-- DropIndex
DROP INDEX "ShariahFlag_segmentId_idx";

-- AlterTable
ALTER TABLE "Transcript" ALTER COLUMN "summaryEmbedding" DROP DEFAULT,
ALTER COLUMN "followUpsRedacted" DROP DEFAULT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "avatarColor" TEXT;
