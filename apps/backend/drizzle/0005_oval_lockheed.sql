ALTER TABLE "contributions" ADD COLUMN "refund_account_number" text;--> statement-breakpoint
ALTER TABLE "contributions" ADD COLUMN "refund_account_name" text;--> statement-breakpoint
ALTER TABLE "contributions" ADD COLUMN "refund_bank" text;--> statement-breakpoint
ALTER TABLE "contributions" DROP COLUMN "refund_destination";