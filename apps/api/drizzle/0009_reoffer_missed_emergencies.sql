ALTER TABLE "job_offers" DROP CONSTRAINT "job_offers_job_pro_uq";--> statement-breakpoint
CREATE INDEX "job_offers_job_pro_idx" ON "job_offers" USING btree ("job_id","pro_id");