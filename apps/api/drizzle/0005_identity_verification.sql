CREATE TYPE "public"."private_file_purpose" AS ENUM('ID_DOCUMENT', 'SELFIE');--> statement-breakpoint
CREATE TABLE "private_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"purpose" "private_file_purpose" NOT NULL,
	"content_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"data_encrypted" text NOT NULL,
	"verification_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "verifications" ADD COLUMN "nin_hash" text;--> statement-breakpoint
ALTER TABLE "verifications" ADD COLUMN "id_document_ref" text;--> statement-breakpoint
ALTER TABLE "verifications" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "verifications" ADD COLUMN "review_note" text;--> statement-breakpoint
ALTER TABLE "private_files" ADD CONSTRAINT "private_files_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_files" ADD CONSTRAINT "private_files_verification_id_verifications_id_fk" FOREIGN KEY ("verification_id") REFERENCES "public"."verifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "private_files_owner_idx" ON "private_files" USING btree ("owner_id","purpose");--> statement-breakpoint
CREATE INDEX "verifications_pro_idx" ON "verifications" USING btree ("pro_id");--> statement-breakpoint
CREATE INDEX "verifications_result_idx" ON "verifications" USING btree ("result");--> statement-breakpoint
CREATE INDEX "verifications_nin_hash_idx" ON "verifications" USING btree ("nin_hash");