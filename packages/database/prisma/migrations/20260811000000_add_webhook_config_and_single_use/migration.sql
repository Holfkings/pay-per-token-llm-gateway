-- Add provider webhook configuration (real webhook delivery + HMAC signing).
ALTER TABLE "Provider" ADD COLUMN "webhookUrl" TEXT;
ALTER TABLE "Provider" ADD COLUMN "webhookSecret" TEXT;

-- Enforce the payment single-use invariant at the database level.
-- A transaction hash may be consumed by exactly one confirmed payment;
-- pending rows keep a NULL txHash and are unaffected.
CREATE UNIQUE INDEX "Payment_txHash_unique_key"
  ON "Payment"("txHash")
  WHERE "txHash" IS NOT NULL;
