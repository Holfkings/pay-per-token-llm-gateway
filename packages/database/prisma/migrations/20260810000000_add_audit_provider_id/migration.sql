-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN "providerId" TEXT;

-- CreateIndex
CREATE INDEX "AuditLog_providerId_idx" ON "AuditLog"("providerId");
