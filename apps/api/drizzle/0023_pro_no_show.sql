CREATE TABLE "no_shows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"pro_id" uuid NOT NULL,
	"recorded_by_id" uuid NOT NULL,
	"replacement_job_id" uuid,
	"refund_kobo" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "no_shows_job_id_unique" UNIQUE("job_id")
);
--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "visit_due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "no_shows" ADD CONSTRAINT "no_shows_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "no_shows" ADD CONSTRAINT "no_shows_pro_id_users_id_fk" FOREIGN KEY ("pro_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "no_shows" ADD CONSTRAINT "no_shows_recorded_by_id_users_id_fk" FOREIGN KEY ("recorded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "no_shows" ADD CONSTRAINT "no_shows_replacement_job_id_jobs_id_fk" FOREIGN KEY ("replacement_job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "no_shows_pro_idx" ON "no_shows" USING btree ("pro_id","created_at");--> statement-breakpoint
UPDATE "jobs" SET "visit_due_at" = greatest("updated_at" + interval '150 minutes', coalesce("scheduled_at" + interval '60 minutes', "updated_at")) WHERE "status" = 'INSPECTION_PAID' AND "arrived_at" IS NULL AND "visit_due_at" IS NULL;
