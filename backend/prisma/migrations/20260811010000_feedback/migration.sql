-- Three buckets rather than a taxonomy: nothing downstream routes on the value,
-- so a longer list would only make the submitter classify instead of write.
CREATE TYPE "FeedbackCategory" AS ENUM ('BUG', 'IDEA', 'OTHER');

-- `message` is user-typed, so it is not RedactedText. The route refuses a
-- submission containing personal data instead of storing and masking it.
CREATE TABLE "Feedback" (
    "id" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "category" "FeedbackCategory" NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);

-- The admin list reads newest-first and nothing looks feedback up by author.
CREATE INDEX "Feedback_createdAt_idx" ON "Feedback"("createdAt");

-- RESTRICT, not CASCADE: accounts are deactivated rather than deleted, and a
-- delete that would silently take someone's feedback with it should fail loudly.
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
