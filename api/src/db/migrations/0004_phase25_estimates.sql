CREATE TYPE "public"."estimate_status" AS ENUM('draft', 'sent', 'accepted', 'declined', 'expired');--> statement-breakpoint
ALTER TYPE "public"."email_kind" ADD VALUE 'estimate';--> statement-breakpoint
ALTER TYPE "public"."permission_resource" ADD VALUE 'estimates';--> statement-breakpoint
CREATE TABLE "estimate_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"estimate_id" uuid NOT NULL,
	"item_id" uuid,
	"description" text NOT NULL,
	"qty" numeric(15, 4) NOT NULL,
	"unit_price" numeric(15, 2) NOT NULL,
	"gst_category" "gst_category" NOT NULL,
	"gst_rate" numeric(6, 4) NOT NULL,
	"gst_amount" numeric(15, 2) NOT NULL,
	"line_total" numeric(15, 2) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "estimates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"estimate_number" text,
	"status" "estimate_status" DEFAULT 'draft' NOT NULL,
	"issue_date" date,
	"expiry_date" date,
	"subtotal" numeric(15, 2) DEFAULT '0' NOT NULL,
	"gst_amount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"total" numeric(15, 2) DEFAULT '0' NOT NULL,
	"notes" text,
	"converted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "estimate_number_prefix" text DEFAULT 'EST-' NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "default_estimate_validity_days" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "estimate_id" uuid;--> statement-breakpoint
ALTER TABLE "estimate_lines" ADD CONSTRAINT "estimate_lines_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimate_lines" ADD CONSTRAINT "estimate_lines_estimate_id_estimates_id_fk" FOREIGN KEY ("estimate_id") REFERENCES "public"."estimates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimate_lines" ADD CONSTRAINT "estimate_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "estimates_business_number_unique" ON "estimates" USING btree ("business_id","estimate_number") WHERE status != 'draft';