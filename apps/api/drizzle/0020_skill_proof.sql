ALTER TYPE "public"."private_file_purpose" ADD VALUE 'ATTESTATION_LETTER' BEFORE 'CHAT_PHOTO';--> statement-breakpoint
ALTER TYPE "public"."private_file_purpose" ADD VALUE 'CERTIFICATE' BEFORE 'CHAT_PHOTO';--> statement-breakpoint
ALTER TABLE "verifications" ADD COLUMN "attestation_ref" text;--> statement-breakpoint
ALTER TABLE "verifications" ADD COLUMN "certificate_ref" text;--> statement-breakpoint
ALTER TABLE "verifications" ADD COLUMN "trained_at" text;--> statement-breakpoint
ALTER TABLE "verifications" ADD COLUMN "trained_by" text;--> statement-breakpoint
ALTER TABLE "verifications" ADD COLUMN "trainer_phone_encrypted" text;--> statement-breakpoint
ALTER TABLE "verifications" ADD COLUMN "tech_links" jsonb;