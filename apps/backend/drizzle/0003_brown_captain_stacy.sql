CREATE TYPE "public"."pot_pending_operation" AS ENUM('payout', 'refund');--> statement-breakpoint
CREATE TYPE "public"."contribution_status" AS ENUM('pending', 'funded', 'underpaid', 'failed');--> statement-breakpoint
CREATE TABLE "contributions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pot_id" uuid NOT NULL,
	"contributor_user_id" uuid NOT NULL,
	"virtual_account_ref" text NOT NULL,
	"virtual_account_number" text,
	"expected_amount_kobo" bigint NOT NULL,
	"status" "contribution_status" DEFAULT 'pending' NOT NULL,
	"anonymous" boolean DEFAULT false NOT NULL,
	"refund_destination" text,
	"transaction_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"funded_at" timestamp with time zone,
	CONSTRAINT "contributions_virtual_account_ref_unique" UNIQUE("virtual_account_ref")
);
--> statement-breakpoint
ALTER TABLE "pots" ADD COLUMN "pending_operation" "pot_pending_operation";--> statement-breakpoint
ALTER TABLE "pots" ADD COLUMN "pending_operation_transaction_id" uuid;--> statement-breakpoint
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_pot_id_pots_id_fk" FOREIGN KEY ("pot_id") REFERENCES "public"."pots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_contributor_user_id_users_id_fk" FOREIGN KEY ("contributor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pots" ADD CONSTRAINT "pots_pending_operation_transaction_id_transactions_id_fk" FOREIGN KEY ("pending_operation_transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;