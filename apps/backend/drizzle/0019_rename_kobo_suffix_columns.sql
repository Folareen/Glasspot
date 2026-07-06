ALTER TABLE "pots" RENAME COLUMN "min_contribution_kobo" TO "min_contribution";--> statement-breakpoint
ALTER TABLE "pots" RENAME COLUMN "max_contribution_kobo" TO "max_contribution";--> statement-breakpoint
ALTER TABLE "pots" RENAME COLUMN "goal_amount_kobo" TO "goal_amount";--> statement-breakpoint
ALTER TABLE "contributions" RENAME COLUMN "expected_amount_kobo" TO "expected_amount";--> statement-breakpoint
ALTER TABLE "contribution_payments" RENAME COLUMN "amount_kobo" TO "amount";--> statement-breakpoint
ALTER TABLE "target_based_payout_configs" RENAME COLUMN "target_amount_kobo" TO "target_amount";--> statement-breakpoint
ALTER TABLE "recurring_payout_configs" RENAME COLUMN "amount_kobo" TO "amount";--> statement-breakpoint
ALTER TABLE "scheduled_payout_legs" RENAME COLUMN "amount_kobo" TO "amount";--> statement-breakpoint
ALTER TABLE "transactions" RENAME COLUMN "amount_kobo" TO "amount";--> statement-breakpoint
ALTER TABLE "ledger_entries" RENAME COLUMN "amount_kobo" TO "amount";--> statement-breakpoint
ALTER TABLE "settlement_batches" RENAME COLUMN "expected_amount_kobo" TO "expected_amount";--> statement-breakpoint
ALTER TABLE "settlement_batches" RENAME COLUMN "reported_amount_kobo" TO "reported_amount";--> statement-breakpoint
ALTER TABLE "reconciliation_records" RENAME COLUMN "internal_amount_kobo" TO "internal_amount";--> statement-breakpoint
ALTER TABLE "reconciliation_records" RENAME COLUMN "external_amount_kobo" TO "external_amount";
