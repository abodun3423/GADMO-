CREATE TYPE "public"."inspection_policy" AS ENUM('REQUIRED', 'OPTIONAL', 'NONE');--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "inspection_policy" "inspection_policy" DEFAULT 'NONE' NOT NULL;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "licence_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;