ALTER TYPE "public"."private_file_purpose" ADD VALUE 'WORK_PHOTO';--> statement-breakpoint
CREATE TABLE "pro_work_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pro_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"caption" text,
	"removed_at" timestamp with time zone,
	"removed_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pro_work_photos" ADD CONSTRAINT "pro_work_photos_pro_id_users_id_fk" FOREIGN KEY ("pro_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pro_work_photos" ADD CONSTRAINT "pro_work_photos_file_id_private_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."private_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pro_work_photos" ADD CONSTRAINT "pro_work_photos_removed_by_id_users_id_fk" FOREIGN KEY ("removed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pro_work_photos_pro_idx" ON "pro_work_photos" USING btree ("pro_id","created_at");