ALTER TABLE "target_based_payout_configs" ADD COLUMN "destination_account_name" text;--> statement-breakpoint
UPDATE "target_based_payout_configs" SET "destination_account_name" = 'unknown (pre-migration row)' WHERE "destination_account_name" IS NULL;--> statement-breakpoint
ALTER TABLE "target_based_payout_configs" ALTER COLUMN "destination_account_name" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "manual_payout_configs" ADD COLUMN "destination_account_name" text;--> statement-breakpoint
ALTER TABLE "recurring_payout_configs" ADD COLUMN "destination_account_name" text;--> statement-breakpoint
UPDATE "recurring_payout_configs" SET "destination_account_name" = 'unknown (pre-migration row)' WHERE "destination_account_name" IS NULL;--> statement-breakpoint
ALTER TABLE "recurring_payout_configs" ALTER COLUMN "destination_account_name" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "scheduled_payout_legs" ADD COLUMN "destination_account_name" text;--> statement-breakpoint
UPDATE "scheduled_payout_legs" SET "destination_account_name" = 'unknown (pre-migration row)' WHERE "destination_account_name" IS NULL;--> statement-breakpoint
ALTER TABLE "scheduled_payout_legs" ALTER COLUMN "destination_account_name" SET NOT NULL;