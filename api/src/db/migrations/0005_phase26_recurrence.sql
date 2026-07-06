CREATE TYPE "public"."recurrence_frequency" AS ENUM('weekly', 'monthly', 'quarterly', 'yearly');--> statement-breakpoint
ALTER TYPE "public"."permission_resource" ADD VALUE 'recurring';--> statement-breakpoint
CREATE TABLE "recurrence_profile_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"item_id" uuid,
	"description" text NOT NULL,
	"qty" numeric(15, 4) NOT NULL,
	"unit_price" numeric(15, 2) NOT NULL,
	"gst_category" "gst_category" NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recurrence_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"name" text NOT NULL,
	"frequency" "recurrence_frequency" NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"next_run_date" date NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"auto_issue" boolean DEFAULT false NOT NULL,
	"due_days_after_issue" integer,
	"notes" text,
	"last_generated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "recurrence_profile_id" uuid;--> statement-breakpoint
ALTER TABLE "recurrence_profile_lines" ADD CONSTRAINT "recurrence_profile_lines_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurrence_profile_lines" ADD CONSTRAINT "recurrence_profile_lines_profile_id_recurrence_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."recurrence_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurrence_profile_lines" ADD CONSTRAINT "recurrence_profile_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurrence_profiles" ADD CONSTRAINT "recurrence_profiles_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurrence_profiles" ADD CONSTRAINT "recurrence_profiles_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;