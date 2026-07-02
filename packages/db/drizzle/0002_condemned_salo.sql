ALTER TABLE "accounts" ALTER COLUMN "owner_type" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."account_owner_type";--> statement-breakpoint
CREATE TYPE "public"."account_owner_type" AS ENUM('pot', 'platform_revenue', 'platform_float', 'suspense', 'provider_settlement');--> statement-breakpoint
ALTER TABLE "accounts" ALTER COLUMN "owner_type" SET DATA TYPE "public"."account_owner_type" USING "owner_type"::"public"."account_owner_type";