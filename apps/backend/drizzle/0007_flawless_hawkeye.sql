CREATE TABLE "contribution_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contribution_id" uuid NOT NULL,
	"nomba_transaction_id" text NOT NULL,
	"amount_kobo" bigint NOT NULL,
	"sender_account_number" text NOT NULL,
	"sender_bank_code" text NOT NULL,
	"sender_name" text NOT NULL,
	"refunded" boolean DEFAULT false NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contribution_payments_nomba_transaction_id_unique" UNIQUE("nomba_transaction_id")
);
--> statement-breakpoint
ALTER TABLE "contributions" ADD COLUMN "expires_at" timestamp with time zone NOT NULL;--> statement-breakpoint
ALTER TABLE "contribution_payments" ADD CONSTRAINT "contribution_payments_contribution_id_contributions_id_fk" FOREIGN KEY ("contribution_id") REFERENCES "public"."contributions"("id") ON DELETE no action ON UPDATE no action;