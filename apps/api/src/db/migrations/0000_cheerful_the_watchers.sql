CREATE TYPE "public"."otp_purpose" AS ENUM('signup_verification', 'login', 'password_reset');--> statement-breakpoint
CREATE TYPE "public"."lock_mode" AS ENUM('locked', 'flexible', 'both');--> statement-breakpoint
CREATE TYPE "public"."pot_status" AS ENUM('ACTIVE', 'CLOSED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."pot_type" AS ENUM('public', 'private');--> statement-breakpoint
CREATE TYPE "public"."pot_member_role" AS ENUM('creator', 'admin', 'member');--> statement-breakpoint
CREATE TYPE "public"."payout_trigger_type" AS ENUM('target_reached', 'date_reached', 'organizer_decision');--> statement-breakpoint
CREATE TYPE "public"."refund_trigger_type" AS ENUM('deadline_unmet', 'member_approval');--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"full_name" text NOT NULL,
	"phone" text,
	"email_verified_at" timestamp with time zone,
	"refresh_token_hash" text,
	"refresh_token_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "otp_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" "otp_purpose" NOT NULL,
	"code_hash" text NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"pot_type" "pot_type" NOT NULL,
	"lock_mode" "lock_mode" NOT NULL,
	"status" "pot_status" DEFAULT 'ACTIVE' NOT NULL,
	"share_slug" text NOT NULL,
	"min_contribution_kobo" bigint DEFAULT 10000 NOT NULL,
	"max_contribution_kobo" bigint,
	"contribution_close_at" timestamp with time zone,
	"rules_locked_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pots_share_slug_unique" UNIQUE("share_slug"),
	CONSTRAINT "chk_max_ge_min" CHECK ("pots"."max_contribution_kobo" IS NULL OR "pots"."max_contribution_kobo" >= "pots"."min_contribution_kobo")
);
--> statement-breakpoint
CREATE TABLE "pot_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pot_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "pot_member_role" DEFAULT 'member' NOT NULL,
	"invited_by_user_id" uuid,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pot_members_pot_id_user_id_key" UNIQUE("pot_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "payout_triggers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pot_id" uuid NOT NULL,
	"type" "payout_trigger_type" NOT NULL,
	"amount_kobo" bigint NOT NULL,
	"destination_account" text NOT NULL,
	"destination_bank" text NOT NULL,
	"config" jsonb NOT NULL,
	"fired" boolean DEFAULT false NOT NULL,
	"fired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refund_triggers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pot_id" uuid NOT NULL,
	"type" "refund_trigger_type" NOT NULL,
	"amount_kobo" bigint NOT NULL,
	"config" jsonb NOT NULL,
	"fired" boolean DEFAULT false NOT NULL,
	"fired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "otp_codes" ADD CONSTRAINT "otp_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pots" ADD CONSTRAINT "pots_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pot_members" ADD CONSTRAINT "pot_members_pot_id_pots_id_fk" FOREIGN KEY ("pot_id") REFERENCES "public"."pots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pot_members" ADD CONSTRAINT "pot_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pot_members" ADD CONSTRAINT "pot_members_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_triggers" ADD CONSTRAINT "payout_triggers_pot_id_pots_id_fk" FOREIGN KEY ("pot_id") REFERENCES "public"."pots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_triggers" ADD CONSTRAINT "refund_triggers_pot_id_pots_id_fk" FOREIGN KEY ("pot_id") REFERENCES "public"."pots"("id") ON DELETE cascade ON UPDATE no action;