ALTER TABLE "payments" ADD COLUMN "gateway" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "checkout_url" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "paid_at" timestamp with time zone;