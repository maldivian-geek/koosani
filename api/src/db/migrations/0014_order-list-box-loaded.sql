ALTER TABLE "order_list_lines" ADD COLUMN "box_no" text;--> statement-breakpoint
ALTER TABLE "order_list_lines" ADD COLUMN "loaded" boolean DEFAULT false NOT NULL;