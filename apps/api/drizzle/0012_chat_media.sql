ALTER TYPE "public"."private_file_purpose" ADD VALUE 'CHAT_PHOTO';--> statement-breakpoint
ALTER TYPE "public"."private_file_purpose" ADD VALUE 'CHAT_VOICE';--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "latitude" double precision;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "longitude" double precision;