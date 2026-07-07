ALTER TYPE "public"."permission_resource" ADD VALUE 'expenses';--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"category" text NOT NULL,
	"description" text,
	"supplier_id" uuid,
	"expense_date" date NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"gst_category" "gst_category" NOT NULL,
	"gst_rate" numeric(6, 4) NOT NULL,
	"gst_amount" numeric(15, 2) NOT NULL,
	"total" numeric(15, 2) NOT NULL,
	"payment_method" text,
	"receipt_file_id" uuid,
	"billable" boolean DEFAULT false NOT NULL,
	"customer_id" uuid,
	"invoice_id" uuid,
	"invoiced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;