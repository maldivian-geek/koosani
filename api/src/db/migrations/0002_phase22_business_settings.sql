ALTER TABLE "businesses" ADD COLUMN "logo_file_id" uuid;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "default_credit_terms_days" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "default_invoice_notes" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "invoice_number_prefix" text DEFAULT 'INV-' NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "credit_note_number_prefix" text DEFAULT 'CN-' NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "bill_number_prefix" text DEFAULT 'BILL-' NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "po_number_prefix" text DEFAULT 'PO-' NOT NULL;