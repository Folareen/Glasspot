CREATE TYPE "public"."otp_purpose" AS ENUM('signup_verification', 'login', 'password_reset');--> statement-breakpoint
CREATE TYPE "public"."payout_mode" AS ENUM('target_based', 'manual', 'recurring', 'rotation', 'scheduled');--> statement-breakpoint
CREATE TYPE "public"."pot_status" AS ENUM('draft', 'open', 'closed');--> statement-breakpoint
CREATE TYPE "public"."pot_type" AS ENUM('public', 'private');--> statement-breakpoint
CREATE TYPE "public"."refund_type" AS ENUM('admin', 'contributors');--> statement-breakpoint
CREATE TYPE "public"."pot_member_role" AS ENUM('admin', 'member');--> statement-breakpoint
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
	"status" "pot_status" DEFAULT 'draft' NOT NULL,
	"payout_mode" "payout_mode" NOT NULL,
	"refund_type" "refund_type" NOT NULL,
	"share_slug" text NOT NULL,
	"min_contribution_kobo" bigint DEFAULT 10000 NOT NULL,
	"max_contribution_kobo" bigint,
	"activated_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
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
CREATE TABLE "target_based_payout_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pot_id" uuid NOT NULL,
	"destination_account" text NOT NULL,
	"destination_bank" text NOT NULL,
	"target_date" timestamp with time zone,
	"target_amount_kobo" bigint,
	"admin_manual_enabled" boolean DEFAULT false NOT NULL,
	"fired" boolean DEFAULT false NOT NULL,
	"fired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "target_based_payout_configs_pot_id_unique" UNIQUE("pot_id"),
	CONSTRAINT "chk_target_based_at_least_one_condition" CHECK ("target_based_payout_configs"."target_date" IS NOT NULL OR "target_based_payout_configs"."target_amount_kobo" IS NOT NULL OR "target_based_payout_configs"."admin_manual_enabled" = true)
);
--> statement-breakpoint
CREATE TABLE "manual_payout_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pot_id" uuid NOT NULL,
	"destination_account" text NOT NULL,
	"destination_bank" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "manual_payout_configs_pot_id_unique" UNIQUE("pot_id")
);
--> statement-breakpoint
CREATE TABLE "recurring_payout_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pot_id" uuid NOT NULL,
	"destination_account" text NOT NULL,
	"destination_bank" text NOT NULL,
	"amount_kobo" bigint NOT NULL,
	"interval_days" integer NOT NULL,
	"next_run_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_payout_configs_pot_id_unique" UNIQUE("pot_id")
);
--> statement-breakpoint
CREATE TABLE "rotation_payout_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pot_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rotation_payout_configs_pot_id_unique" UNIQUE("pot_id")
);
--> statement-breakpoint
CREATE TABLE "rotation_payout_legs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rotation_config_id" uuid NOT NULL,
	"sequence_order" integer NOT NULL,
	"destination_account" text NOT NULL,
	"destination_bank" text NOT NULL,
	"amount_kobo" bigint NOT NULL,
	"scheduled_date" timestamp with time zone NOT NULL,
	"fired" boolean DEFAULT false NOT NULL,
	"fired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rotation_payout_legs_config_id_sequence_order_key" UNIQUE("rotation_config_id","sequence_order")
);
--> statement-breakpoint
CREATE TABLE "scheduled_payout_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pot_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scheduled_payout_configs_pot_id_unique" UNIQUE("pot_id")
);
--> statement-breakpoint
CREATE TABLE "scheduled_payout_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scheduled_config_id" uuid NOT NULL,
	"destination_account" text NOT NULL,
	"destination_bank" text NOT NULL,
	"amount_kobo" bigint NOT NULL,
	"scheduled_date" timestamp with time zone NOT NULL,
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
ALTER TABLE "target_based_payout_configs" ADD CONSTRAINT "target_based_payout_configs_pot_id_pots_id_fk" FOREIGN KEY ("pot_id") REFERENCES "public"."pots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_payout_configs" ADD CONSTRAINT "manual_payout_configs_pot_id_pots_id_fk" FOREIGN KEY ("pot_id") REFERENCES "public"."pots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_payout_configs" ADD CONSTRAINT "recurring_payout_configs_pot_id_pots_id_fk" FOREIGN KEY ("pot_id") REFERENCES "public"."pots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rotation_payout_configs" ADD CONSTRAINT "rotation_payout_configs_pot_id_pots_id_fk" FOREIGN KEY ("pot_id") REFERENCES "public"."pots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rotation_payout_legs" ADD CONSTRAINT "rotation_payout_legs_rotation_config_id_rotation_payout_configs_id_fk" FOREIGN KEY ("rotation_config_id") REFERENCES "public"."rotation_payout_configs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_payout_configs" ADD CONSTRAINT "scheduled_payout_configs_pot_id_pots_id_fk" FOREIGN KEY ("pot_id") REFERENCES "public"."pots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_payout_entries" ADD CONSTRAINT "scheduled_payout_entries_scheduled_config_id_scheduled_payout_configs_id_fk" FOREIGN KEY ("scheduled_config_id") REFERENCES "public"."scheduled_payout_configs"("id") ON DELETE cascade ON UPDATE no action;