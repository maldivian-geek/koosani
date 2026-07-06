CREATE TYPE "public"."currency_code" AS ENUM('MVR', 'USD', 'EUR', 'GBP');--> statement-breakpoint
CREATE TABLE "exchange_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"currency" "currency_code" NOT NULL,
	"rate" numeric(15, 6) NOT NULL,
	"rate_date" date NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fx_realized_gain_loss" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "currency" "currency_code" DEFAULT 'MVR' NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_note_lines" ADD COLUMN "gst_amount_mvr" numeric(15, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_note_lines" ADD COLUMN "line_total_mvr" numeric(15, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD COLUMN "currency" "currency_code" DEFAULT 'MVR' NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD COLUMN "exchange_rate" numeric(15, 6) DEFAULT '1' NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD COLUMN "subtotal_mvr" numeric(15, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD COLUMN "gst_amount_mvr" numeric(15, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD COLUMN "total_mvr" numeric(15, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN "gst_amount_mvr" numeric(15, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN "line_total_mvr" numeric(15, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "currency" "currency_code" DEFAULT 'MVR' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "exchange_rate" numeric(15, 6) DEFAULT '1' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "subtotal_mvr" numeric(15, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "gst_amount_mvr" numeric(15, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "total_mvr" numeric(15, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "paid_amount_mvr" numeric(15, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "payments_received" ADD COLUMN "exchange_rate" numeric(15, 6) DEFAULT '1' NOT NULL;--> statement-breakpoint
ALTER TABLE "payments_received" ADD COLUMN "amount_mvr" numeric(15, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "estimate_lines" ADD COLUMN "gst_amount_mvr" numeric(15, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "estimate_lines" ADD COLUMN "line_total_mvr" numeric(15, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN "currency" "currency_code" DEFAULT 'MVR' NOT NULL;--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN "exchange_rate" numeric(15, 6) DEFAULT '1' NOT NULL;--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN "subtotal_mvr" numeric(15, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN "gst_amount_mvr" numeric(15, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN "total_mvr" numeric(15, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_realized_gain_loss" ADD CONSTRAINT "fx_realized_gain_loss_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_realized_gain_loss" ADD CONSTRAINT "fx_realized_gain_loss_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "exchange_rates_business_currency_date_idx" ON "exchange_rates" USING btree ("business_id","currency","rate_date");