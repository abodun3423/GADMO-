CREATE TYPE "public"."skill_check_result" AS ENUM('PENDING', 'PASSED', 'FAILED');--> statement-breakpoint
ALTER TYPE "public"."verification_status" ADD VALUE 'SKILL_CHECK';--> statement-breakpoint
CREATE TABLE "skill_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pro_id" uuid NOT NULL,
	"verification_id" uuid NOT NULL,
	"result" "skill_check_result" DEFAULT 'PENDING' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"visit_place" text,
	"scheduled_by_id" uuid,
	"checked_by_id" uuid,
	"checked_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "skill_checks" ADD CONSTRAINT "skill_checks_pro_id_pro_profiles_user_id_fk" FOREIGN KEY ("pro_id") REFERENCES "public"."pro_profiles"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_checks" ADD CONSTRAINT "skill_checks_verification_id_verifications_id_fk" FOREIGN KEY ("verification_id") REFERENCES "public"."verifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_checks" ADD CONSTRAINT "skill_checks_scheduled_by_id_users_id_fk" FOREIGN KEY ("scheduled_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_checks" ADD CONSTRAINT "skill_checks_checked_by_id_users_id_fk" FOREIGN KEY ("checked_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "skill_checks_pro_idx" ON "skill_checks" USING btree ("pro_id");--> statement-breakpoint
CREATE INDEX "skill_checks_result_idx" ON "skill_checks" USING btree ("result");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_checks_open_uq" ON "skill_checks" USING btree ("pro_id") WHERE "skill_checks"."result" = 'PENDING';