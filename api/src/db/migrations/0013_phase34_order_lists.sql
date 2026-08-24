CREATE TYPE "public"."order_list_payment_status" AS ENUM('pending', 'paid');--> statement-breakpoint
CREATE TYPE "public"."order_list_stock_status" AS ENUM('unknown', 'in_stock', 'available', 'not_available');--> statement-breakpoint
ALTER TYPE "public"."permission_resource" ADD VALUE 'orders';--> statement-breakpoint
CREATE TABLE "order_list_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"order_list_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"item_name" text NOT NULL,
	"qty" numeric(14, 4) DEFAULT '1' NOT NULL,
	"uom" text DEFAULT 'Each' NOT NULL,
	"note" text,
	"additional_note" text,
	"payment_status" "order_list_payment_status" DEFAULT 'pending' NOT NULL,
	"stock_status" "order_list_stock_status" DEFAULT 'unknown' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"title" text NOT NULL,
	"notes" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "customer_item_name" text;--> statement-breakpoint
ALTER TABLE "order_list_lines" ADD CONSTRAINT "order_list_lines_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_list_lines" ADD CONSTRAINT "order_list_lines_order_list_id_order_lists_id_fk" FOREIGN KEY ("order_list_id") REFERENCES "public"."order_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lists" ADD CONSTRAINT "order_lists_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;