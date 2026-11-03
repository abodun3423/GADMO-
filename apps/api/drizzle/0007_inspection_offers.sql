CREATE TYPE "public"."inspection_offer_status" AS ENUM('PENDING', 'ACCEPTED', 'COUNTERED', 'DECLINED');--> statement-breakpoint
CREATE TABLE "inspection_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"proposed_by_id" uuid NOT NULL,
	"amount_kobo" bigint NOT NULL,
	"note" text,
	"status" "inspection_offer_status" DEFAULT 'PENDING' NOT NULL,
	"responded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inspection_offers_amount_range" CHECK ("inspection_offers"."amount_kobo" > 0 and "inspection_offers"."amount_kobo" <= 500000)
);
--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "inspection_fee_kobo" bigint;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "inspection_agreed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "kind" text DEFAULT 'TEXT' NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "offer_id" uuid;--> statement-breakpoint
ALTER TABLE "inspection_offers" ADD CONSTRAINT "inspection_offers_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_offers" ADD CONSTRAINT "inspection_offers_proposed_by_id_users_id_fk" FOREIGN KEY ("proposed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inspection_offers_job_idx" ON "inspection_offers" USING btree ("job_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "inspection_offers_one_pending_per_job" ON "inspection_offers" USING btree ("job_id") WHERE "inspection_offers"."status" = 'PENDING';--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_offer_id_inspection_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."inspection_offers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_inspection_fee_range" CHECK ("jobs"."inspection_fee_kobo" is null or ("jobs"."inspection_fee_kobo" > 0 and "jobs"."inspection_fee_kobo" <= 500000));