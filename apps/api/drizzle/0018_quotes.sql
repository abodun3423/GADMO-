CREATE TYPE "public"."quote_status" AS ENUM('PENDING', 'ACCEPTED', 'DECLINED', 'WITHDRAWN');--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "quote_id" uuid;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "quote_id" uuid;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "status" "quote_status" DEFAULT 'PENDING' NOT NULL;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "responded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "quotes_job_idx" ON "quotes" USING btree ("job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "quotes_one_pending_per_job" ON "quotes" USING btree ("job_id") WHERE "quotes"."status" = 'PENDING';