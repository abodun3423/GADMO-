ALTER TABLE "messages" ADD COLUMN "seq" bigserial NOT NULL;--> statement-breakpoint
-- Number existing messages in the order they were stored until now.
UPDATE "messages" AS m SET "seq" = r.rn
FROM (SELECT "id", row_number() OVER (ORDER BY "created_at", "id") AS rn FROM "messages") AS r
WHERE m."id" = r."id";--> statement-breakpoint
SELECT setval(pg_get_serial_sequence('messages', 'seq'), GREATEST((SELECT max("seq") FROM "messages"), 1));--> statement-breakpoint
CREATE INDEX "messages_job_seq_idx" ON "messages" USING btree ("job_id","seq");
