CREATE TYPE "public"."offer_status" AS ENUM('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'WITHDRAWN');--> statement-breakpoint
CREATE TABLE "job_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"pro_id" uuid NOT NULL,
	"status" "offer_status" DEFAULT 'PENDING' NOT NULL,
	"distance_km" double precision NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"responded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_offers_job_pro_uq" UNIQUE("job_id","pro_id")
);
--> statement-breakpoint
ALTER TABLE "job_offers" ADD CONSTRAINT "job_offers_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_offers" ADD CONSTRAINT "job_offers_pro_id_users_id_fk" FOREIGN KEY ("pro_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "job_offers_one_pending_per_job" ON "job_offers" USING btree ("job_id") WHERE "job_offers"."status" = 'PENDING';--> statement-breakpoint
CREATE INDEX "job_offers_pro_status_idx" ON "job_offers" USING btree ("pro_id","status");