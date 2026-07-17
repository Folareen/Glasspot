ALTER TABLE "contributions" ADD COLUMN "intended_amount" bigint;--> statement-breakpoint
-- Backfill using the old flat ₦20 inbound fee (2000 kobo), in effect for every existing row.
UPDATE "contributions" SET "intended_amount" = "expected_amount" - 2000 WHERE "intended_amount" IS NULL;--> statement-breakpoint
ALTER TABLE "contributions" ALTER COLUMN "intended_amount" SET NOT NULL;
