ALTER TYPE "public"."payout_mode" ADD VALUE 'scheduled' BEFORE 'rotation';--> statement-breakpoint
CREATE TABLE "scheduled_payout_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pot_id" uuid NOT NULL,
	"ordered" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scheduled_payout_configs_pot_id_unique" UNIQUE("pot_id")
);
--> statement-breakpoint
CREATE TABLE "scheduled_payout_legs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scheduled_config_id" uuid NOT NULL,
	"sequence_order" integer NOT NULL,
	"destination_account" text NOT NULL,
	"destination_bank" text NOT NULL,
	"amount_kobo" bigint NOT NULL,
	"scheduled_date" timestamp with time zone NOT NULL,
	"fired" boolean DEFAULT false NOT NULL,
	"fired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scheduled_payout_legs_config_id_sequence_order_key" UNIQUE("scheduled_config_id","sequence_order")
);
--> statement-breakpoint
ALTER TABLE "scheduled_payout_configs" ADD CONSTRAINT "scheduled_payout_configs_pot_id_pots_id_fk" FOREIGN KEY ("pot_id") REFERENCES "public"."pots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_payout_legs" ADD CONSTRAINT "scheduled_payout_legs_scheduled_config_id_scheduled_payout_configs_id_fk" FOREIGN KEY ("scheduled_config_id") REFERENCES "public"."scheduled_payout_configs"("id") ON DELETE cascade ON UPDATE no action;