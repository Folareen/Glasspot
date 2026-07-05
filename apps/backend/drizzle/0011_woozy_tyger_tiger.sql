CREATE TYPE "public"."failed_job_status" AS ENUM('pending', 'retried', 'ignored');--> statement-breakpoint
CREATE TABLE "failed_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"queue_name" text NOT NULL,
	"job_name" text NOT NULL,
	"job_id" text NOT NULL,
	"data" jsonb NOT NULL,
	"failed_reason" text NOT NULL,
	"attempts_made" integer NOT NULL,
	"status" "failed_job_status" DEFAULT 'pending' NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "failed_jobs_queue_name_job_id_key" UNIQUE("queue_name","job_id")
);
