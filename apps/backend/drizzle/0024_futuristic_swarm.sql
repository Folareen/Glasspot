ALTER TYPE "public"."pot_invite_status" RENAME TO "pot_pending_member_status";--> statement-breakpoint
ALTER TABLE "pot_invites" RENAME TO "pot_pending_members";--> statement-breakpoint
ALTER TABLE "pot_pending_members" RENAME COLUMN "invited_by_user_id" TO "added_by_user_id";--> statement-breakpoint
ALTER TABLE "pot_pending_members" RENAME COLUMN "accepted_user_id" TO "joined_user_id";--> statement-breakpoint
ALTER TABLE "pot_pending_members" RENAME COLUMN "accepted_at" TO "joined_at";--> statement-breakpoint
ALTER TABLE "pot_members" DROP CONSTRAINT "pot_members_invited_by_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "pot_pending_members" DROP CONSTRAINT "pot_invites_pot_id_pots_id_fk";
--> statement-breakpoint
ALTER TABLE "pot_pending_members" DROP CONSTRAINT "pot_invites_invited_by_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "pot_pending_members" DROP CONSTRAINT "pot_invites_accepted_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "pot_pending_members" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "pot_pending_members" ALTER COLUMN "status" SET DEFAULT 'pending'::text;--> statement-breakpoint
-- accepted/cancelled are the old pot_invites values, renamed to joined/removed to match the
-- no-accept/decline "add member" semantics — mapped explicitly (not just re-cast) so this is safe
-- even against rows written before this migration, not just the empty dev table it shipped against.
UPDATE "pot_pending_members" SET "status" = 'joined' WHERE "status" = 'accepted';--> statement-breakpoint
UPDATE "pot_pending_members" SET "status" = 'removed' WHERE "status" = 'cancelled';--> statement-breakpoint
DROP TYPE "public"."pot_pending_member_status";--> statement-breakpoint
CREATE TYPE "public"."pot_pending_member_status" AS ENUM('pending', 'joined', 'removed');--> statement-breakpoint
ALTER TABLE "pot_pending_members" ALTER COLUMN "status" SET DEFAULT 'pending'::"public"."pot_pending_member_status";--> statement-breakpoint
ALTER TABLE "pot_pending_members" ALTER COLUMN "status" SET DATA TYPE "public"."pot_pending_member_status" USING "status"::"public"."pot_pending_member_status";--> statement-breakpoint
ALTER TABLE "pot_members" ADD COLUMN "added_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "pot_members" ADD CONSTRAINT "pot_members_added_by_user_id_users_id_fk" FOREIGN KEY ("added_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pot_pending_members" ADD CONSTRAINT "pot_pending_members_pot_id_pots_id_fk" FOREIGN KEY ("pot_id") REFERENCES "public"."pots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pot_pending_members" ADD CONSTRAINT "pot_pending_members_added_by_user_id_users_id_fk" FOREIGN KEY ("added_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pot_pending_members" ADD CONSTRAINT "pot_pending_members_joined_user_id_users_id_fk" FOREIGN KEY ("joined_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pot_members" DROP COLUMN "invited_by_user_id";