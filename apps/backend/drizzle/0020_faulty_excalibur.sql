CREATE TYPE "public"."action_otp_action" AS ENUM('trigger_payout', 'trigger_refund');--> statement-breakpoint
CREATE TABLE "action_otp_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"action" "action_otp_action" NOT NULL,
	"pot_id" uuid NOT NULL,
	"context_hash" text NOT NULL,
	"code_hash" text NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "action_otp_codes" ADD CONSTRAINT "action_otp_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;