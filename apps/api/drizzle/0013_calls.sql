CREATE TYPE "public"."call_status" AS ENUM('RINGING', 'ACTIVE', 'ENDED', 'MISSED', 'DECLINED');--> statement-breakpoint
CREATE TABLE "calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"caller_id" uuid NOT NULL,
	"callee_id" uuid NOT NULL,
	"status" "call_status" DEFAULT 'RINGING' NOT NULL,
	"offer_sdp" text NOT NULL,
	"answer_sdp" text,
	"caller_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"callee_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"answered_at" timestamp with time zone,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_caller_id_users_id_fk" FOREIGN KEY ("caller_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_callee_id_users_id_fk" FOREIGN KEY ("callee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "calls_one_live_per_job" ON "calls" USING btree ("job_id") WHERE "calls"."status" in ('RINGING', 'ACTIVE');