ALTER TABLE "jobs" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "reviews_subject_idx" ON "reviews" USING btree ("subject_id","created_at");--> statement-breakpoint
UPDATE "jobs" SET "completed_at" = "updated_at" WHERE "status" IN ('COMPLETED', 'CASH_COMPLETED') AND "completed_at" IS NULL;
