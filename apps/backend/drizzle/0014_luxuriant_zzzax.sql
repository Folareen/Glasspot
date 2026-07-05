DROP TABLE "rotation_payout_configs" CASCADE;--> statement-breakpoint
DROP TABLE "rotation_payout_legs" CASCADE;--> statement-breakpoint
ALTER TABLE "pots" ALTER COLUMN "payout_mode" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."payout_mode";--> statement-breakpoint
CREATE TYPE "public"."payout_mode" AS ENUM('target_based', 'manual', 'recurring', 'scheduled');--> statement-breakpoint
ALTER TABLE "pots" ALTER COLUMN "payout_mode" SET DATA TYPE "public"."payout_mode" USING "payout_mode"::"public"."payout_mode";