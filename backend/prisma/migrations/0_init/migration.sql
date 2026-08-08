-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('VIEWER', 'MAKER', 'CHECKER', 'SHARIAH', 'SUPERVISOR', 'ADMIN');

-- CreateEnum
CREATE TYPE "MeetingStatus" AS ENUM ('CAPTURED', 'PROCESSING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "PiiType" AS ENUM ('NRIC', 'BANK_ACCOUNT', 'PHONE', 'EMAIL', 'PERSON_NAME', 'ADDRESS', 'CARD');

-- CreateEnum
CREATE TYPE "ShariahIssueType" AS ENUM ('RIBA', 'GHARAR', 'MAYSIR', 'HARAM_SECTOR', 'CONTRACT_MISMATCH', 'LATE_PAYMENT_PENALTY');

-- CreateEnum
CREATE TYPE "ShariahStatus" AS ENUM ('FLAGGED', 'UNDER_REVIEW', 'CLEARED', 'CONFIRMED_VIOLATION');

-- CreateEnum
CREATE TYPE "FacilityKind" AS ENUM ('CONVENTIONAL', 'ISLAMIC');

-- CreateEnum
CREATE TYPE "IslamicContract" AS ENUM ('MURABAHAH', 'TAWARRUQ', 'IJARAH', 'MUSHARAKAH', 'MUDHARABAH', 'ISTISNA', 'SALAM');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('DRAFT', 'PENDING_CHECKER', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Meeting" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "status" "MeetingStatus" NOT NULL DEFAULT 'CAPTURED',
    "failureReason" TEXT,
    "consentConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Meeting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transcript" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "rawRedacted" TEXT NOT NULL,
    "summaryEn" TEXT NOT NULL,
    "languages" TEXT[],
    "modelId" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Transcript_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TranscriptSegment" (
    "id" TEXT NOT NULL,
    "transcriptId" TEXT NOT NULL,
    "startMs" INTEGER NOT NULL,
    "endMs" INTEGER NOT NULL,
    "speakerLabel" TEXT NOT NULL,
    "textRedacted" TEXT NOT NULL,

    CONSTRAINT "TranscriptSegment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Redaction" (
    "id" TEXT NOT NULL,
    "transcriptId" TEXT NOT NULL,
    "piiType" "PiiType" NOT NULL,
    "placeholder" TEXT NOT NULL,
    "startOffset" INTEGER NOT NULL,
    "endOffset" INTEGER NOT NULL,
    "detectedBy" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "vaultId" TEXT,

    CONSTRAINT "Redaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PiiVault" (
    "id" TEXT NOT NULL,
    "ciphertext" BYTEA NOT NULL,
    "iv" BYTEA NOT NULL,
    "authTag" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PiiVault_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Whiteboard" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "mermaid" TEXT NOT NULL,
    "structuredJson" JSONB NOT NULL,
    "modelId" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Whiteboard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShariahFlag" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "issueType" "ShariahIssueType" NOT NULL,
    "excerpt" TEXT NOT NULL,
    "detectedBy" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "reference" TEXT NOT NULL,
    "status" "ShariahStatus" NOT NULL DEFAULT 'FLAGGED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,

    CONSTRAINT "ShariahFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TermSheet" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "applicantName" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'MYR',
    "principalMinor" BIGINT NOT NULL,
    "tenureMonths" INTEGER NOT NULL,
    "facilityKind" "FacilityKind" NOT NULL,
    "interestRateBps" INTEGER,
    "profitRateBps" INTEGER,
    "islamicContract" "IslamicContract",
    "status" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TermSheet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Approval" (
    "id" TEXT NOT NULL,
    "termSheetId" TEXT NOT NULL,
    "makerId" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkerId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decision" "ApprovalStatus" NOT NULL DEFAULT 'PENDING_CHECKER',
    "note" TEXT,

    CONSTRAINT "Approval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiOutputSnapshot" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "promptRedacted" TEXT NOT NULL,
    "responseRaw" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiOutputSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HumanEdit" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "editorId" TEXT NOT NULL,
    "fieldPath" TEXT NOT NULL,
    "aiValue" TEXT NOT NULL,
    "humanValue" TEXT NOT NULL,
    "editedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HumanEdit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEntry" (
    "id" BIGSERIAL NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,
    "actorRole" "Role",
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "prevHash" TEXT NOT NULL,
    "hash" TEXT NOT NULL,

    CONSTRAINT "AuditEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Meeting_createdById_idx" ON "Meeting"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "Transcript_meetingId_key" ON "Transcript"("meetingId");

-- CreateIndex
CREATE INDEX "TranscriptSegment_transcriptId_startMs_idx" ON "TranscriptSegment"("transcriptId", "startMs");

-- CreateIndex
CREATE UNIQUE INDEX "Redaction_vaultId_key" ON "Redaction"("vaultId");

-- CreateIndex
CREATE INDEX "Redaction_transcriptId_idx" ON "Redaction"("transcriptId");

-- CreateIndex
CREATE INDEX "Whiteboard_meetingId_idx" ON "Whiteboard"("meetingId");

-- CreateIndex
CREATE INDEX "ShariahFlag_meetingId_status_idx" ON "ShariahFlag"("meetingId", "status");

-- CreateIndex
CREATE INDEX "TermSheet_meetingId_idx" ON "TermSheet"("meetingId");

-- CreateIndex
CREATE UNIQUE INDEX "Approval_termSheetId_key" ON "Approval"("termSheetId");

-- CreateIndex
CREATE INDEX "AiOutputSnapshot_entityType_entityId_idx" ON "AiOutputSnapshot"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "HumanEdit_entityType_entityId_idx" ON "HumanEdit"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "AuditEntry_hash_key" ON "AuditEntry"("hash");

-- CreateIndex
CREATE INDEX "AuditEntry_entityType_entityId_idx" ON "AuditEntry"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditEntry_at_idx" ON "AuditEntry"("at");

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transcript" ADD CONSTRAINT "Transcript_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TranscriptSegment" ADD CONSTRAINT "TranscriptSegment_transcriptId_fkey" FOREIGN KEY ("transcriptId") REFERENCES "Transcript"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Redaction" ADD CONSTRAINT "Redaction_transcriptId_fkey" FOREIGN KEY ("transcriptId") REFERENCES "Transcript"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Redaction" ADD CONSTRAINT "Redaction_vaultId_fkey" FOREIGN KEY ("vaultId") REFERENCES "PiiVault"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Whiteboard" ADD CONSTRAINT "Whiteboard_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShariahFlag" ADD CONSTRAINT "ShariahFlag_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShariahFlag" ADD CONSTRAINT "ShariahFlag_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TermSheet" ADD CONSTRAINT "TermSheet_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_termSheetId_fkey" FOREIGN KEY ("termSheetId") REFERENCES "TermSheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_makerId_fkey" FOREIGN KEY ("makerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_checkerId_fkey" FOREIGN KEY ("checkerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HumanEdit" ADD CONSTRAINT "HumanEdit_editorId_fkey" FOREIGN KEY ("editorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

