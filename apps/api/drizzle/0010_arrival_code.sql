ALTER TABLE "jobs" ADD COLUMN "arrival_code_encrypted" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "on_the_way_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "arrived_at" timestamp with time zone;