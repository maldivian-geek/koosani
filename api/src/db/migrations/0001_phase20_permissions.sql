CREATE TYPE "public"."permission_action" AS ENUM('view', 'add', 'edit', 'delete', 'export');--> statement-breakpoint
CREATE TYPE "public"."permission_resource" AS ENUM('customers', 'suppliers', 'items', 'inventory', 'invoices', 'bills', 'po', 'gst', 'reports');--> statement-breakpoint
CREATE TABLE "user_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"resource" "permission_resource" NOT NULL,
	"action" "permission_action" NOT NULL,
	"granted_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_permissions_unique" ON "user_permissions" USING btree ("user_id","resource","action");--> statement-breakpoint

-- ─── Phase 20 hardening (UPGRADE.md) ───────────────────────────────────────────

-- F-10: DB-level backstop for negative stock. The service layer already locks
-- the item row (FOR UPDATE) before checking availability; this trigger is the
-- last line of defence per ARCHITECTURE.md §4.3/CLAUDE.md §4 ("DB constraints
-- are the last line of defence"). Redefines the existing function in place —
-- the trigger created in 0000 already points to it by name.
CREATE OR REPLACE FUNCTION update_stock_on_hand()
RETURNS TRIGGER AS $$
DECLARE
  new_on_hand NUMERIC(15,4);
  backorders_allowed BOOLEAN;
BEGIN
  UPDATE items
  SET stock_on_hand = stock_on_hand + NEW.qty
  WHERE id = NEW.item_id
  RETURNING stock_on_hand INTO new_on_hand;

  IF new_on_hand < 0 THEN
    SELECT allow_backorders INTO backorders_allowed
    FROM businesses WHERE id = NEW.business_id;

    IF NOT COALESCE(backorders_allowed, false) THEN
      RAISE EXCEPTION 'Stock movement would result in negative on-hand (%) for item % — rejected (business does not allow backorders)',
        new_on_hand, NEW.item_id USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

-- F-12: line-table immutability. The header-level guards (0000) protect
-- invoices/bills/credit_notes/purchase_orders but not their line tables —
-- an issued document's lines could previously be UPDATEd/DELETEd directly.
CREATE OR REPLACE FUNCTION guard_invoice_line_frozen()
RETURNS TRIGGER AS $$
DECLARE
  parent_status invoice_status;
BEGIN
  SELECT status INTO parent_status FROM invoices WHERE id = COALESCE(NEW.invoice_id, OLD.invoice_id);
  IF parent_status IS NOT NULL AND parent_status <> 'draft' THEN
    RAISE EXCEPTION 'Invoice line % is immutable (parent invoice status=%)', COALESCE(NEW.id, OLD.id), parent_status
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER trg_invoice_lines_immutable
  BEFORE UPDATE OR DELETE ON invoice_lines
  FOR EACH ROW EXECUTE FUNCTION guard_invoice_line_frozen();--> statement-breakpoint

CREATE OR REPLACE FUNCTION guard_bill_line_frozen()
RETURNS TRIGGER AS $$
DECLARE
  parent_status bill_status;
BEGIN
  SELECT status INTO parent_status FROM bills WHERE id = COALESCE(NEW.bill_id, OLD.bill_id);
  IF parent_status IS NOT NULL AND parent_status <> 'draft' THEN
    RAISE EXCEPTION 'Bill line % is immutable (parent bill status=%)', COALESCE(NEW.id, OLD.id), parent_status
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER trg_bill_lines_immutable
  BEFORE UPDATE OR DELETE ON bill_lines
  FOR EACH ROW EXECUTE FUNCTION guard_bill_line_frozen();--> statement-breakpoint

CREATE OR REPLACE FUNCTION guard_credit_note_line_frozen()
RETURNS TRIGGER AS $$
DECLARE
  parent_status credit_note_status;
BEGIN
  SELECT status INTO parent_status FROM credit_notes WHERE id = COALESCE(NEW.credit_note_id, OLD.credit_note_id);
  IF parent_status = 'issued' THEN
    RAISE EXCEPTION 'Credit note line % is immutable (parent credit note is issued)', COALESCE(NEW.id, OLD.id)
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER trg_credit_note_lines_immutable
  BEFORE UPDATE OR DELETE ON credit_note_lines
  FOR EACH ROW EXECUTE FUNCTION guard_credit_note_line_frozen();--> statement-breakpoint

-- F-12: financial documents are never hard-deleted (ARCHITECTURE.md §5) — no
-- route or service ever deletes these rows; REVOKE closes the DB-level gap.
REVOKE DELETE ON invoices         FROM koosani_app;--> statement-breakpoint
REVOKE DELETE ON bills            FROM koosani_app;--> statement-breakpoint
REVOKE DELETE ON credit_notes     FROM koosani_app;--> statement-breakpoint
REVOKE DELETE ON purchase_orders  FROM koosani_app;