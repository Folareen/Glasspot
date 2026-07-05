CREATE TABLE "manual_payout_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pot_id" uuid NOT NULL,
	"destination_account" text,
	"destination_bank" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "manual_payout_configs_pot_id_unique" UNIQUE("pot_id"),
	CONSTRAINT "chk_manual_destination_both_or_neither" CHECK (("manual_payout_configs"."destination_account" IS NULL AND "manual_payout_configs"."destination_bank" IS NULL) OR ("manual_payout_configs"."destination_account" IS NOT NULL AND "manual_payout_configs"."destination_bank" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "manual_payout_configs" ADD CONSTRAINT "manual_payout_configs_pot_id_pots_id_fk" FOREIGN KEY ("pot_id") REFERENCES "public"."pots"("id") ON DELETE cascade ON UPDATE no action;