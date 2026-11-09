-- CreateEnum
CREATE TYPE "cashback_entry_type" AS ENUM ('earn', 'redeem', 'redeem_return', 'earn_reversal');

-- CreateEnum
CREATE TYPE "coupon_discount_type" AS ENUM ('percent', 'fixed');

-- CreateEnum
CREATE TYPE "booking_status" AS ENUM ('confirmed', 'refused', 'cancelled', 'seated');

-- CreateEnum
CREATE TYPE "support_priority" AS ENUM ('low', 'normal', 'high', 'urgent');

-- CreateEnum
CREATE TYPE "support_status" AS ENUM ('open', 'in_progress', 'resolved');

-- CreateEnum
CREATE TYPE "integration_kind" AS ENUM ('pdv', 'erp', 'delivery', 'other');

-- CreateEnum
CREATE TYPE "integration_status" AS ENUM ('unknown', 'online', 'offline');

-- CreateEnum
CREATE TYPE "invoice_status" AS ENUM ('pending', 'paid', 'overdue', 'cancelled');

-- AlterEnum
ALTER TYPE "staff_alert_kind" ADD VALUE 'ingredient_expiring';

-- AlterTable
ALTER TABLE "establishments" ADD COLUMN     "expiry_alert_days" INTEGER NOT NULL DEFAULT 7,
ADD COLUMN     "rating_sum" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "menu_items" ADD COLUMN     "allergens" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "cashback_earn_cents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "cashback_rule_id" UUID,
ADD COLUMN     "cashback_used_cents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "coupon_code" VARCHAR(32),
ADD COLUMN     "coupon_discount_cents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "coupon_id" UUID;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "dietary_restrictions" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "app_notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "establishment_id" UUID,
    "required_permission" VARCHAR(64),
    "kind" VARCHAR(40) NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "body" VARCHAR(400) NOT NULL,
    "ref_id" UUID,
    "dedupe_key" VARCHAR(120),
    "read_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cashback_rules" (
    "id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "percent" SMALLINT NOT NULL,
    "promotion_id" UUID,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "cashback_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cashback_ledger" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "type" "cashback_entry_type" NOT NULL,
    "cents" INTEGER NOT NULL,
    "note" VARCHAR(120),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cashback_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupons" (
    "id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "description" VARCHAR(120) NOT NULL DEFAULT '',
    "discount_type" "coupon_discount_type" NOT NULL,
    "discount_value" INTEGER NOT NULL,
    "min_order_cents" INTEGER NOT NULL DEFAULT 0,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "max_uses" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "coupons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupon_redemptions" (
    "id" UUID NOT NULL,
    "coupon_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coupon_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_payment_methods" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" "payment_method" NOT NULL,
    "brand" VARCHAR(20) NOT NULL,
    "last4" CHAR(4) NOT NULL,
    "exp_month" SMALLINT NOT NULL,
    "exp_year" SMALLINT NOT NULL,
    "holder_name" VARCHAR(60) NOT NULL,
    "token" VARCHAR(128) NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_payment_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "table_id" UUID,
    "party_size" SMALLINT NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "status" "booking_status" NOT NULL,
    "refusal_reason" VARCHAR(120),
    "cancelled_by_id" UUID,
    "cancelled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "rating" SMALLINT NOT NULL,
    "comment" VARCHAR(500) NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "share_visits" (
    "id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "source" VARCHAR(30) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "share_visits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingredient_lots" (
    "id" UUID NOT NULL,
    "ingredient_id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "quantity" DECIMAL(14,4),
    "expires_on" DATE NOT NULL,
    "closed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ingredient_lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_tickets" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "establishment_id" UUID NOT NULL,
    "created_by_id" UUID,
    "subject" VARCHAR(120) NOT NULL,
    "priority" "support_priority" NOT NULL DEFAULT 'normal',
    "status" "support_status" NOT NULL DEFAULT 'open',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "last_message_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(3),

    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_messages" (
    "id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "author_id" UUID,
    "author_name" VARCHAR(120) NOT NULL,
    "side" VARCHAR(20) NOT NULL,
    "body" VARCHAR(2000) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integrations" (
    "id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "kind" "integration_kind" NOT NULL,
    "key_hash" CHAR(64) NOT NULL,
    "status" "integration_status" NOT NULL DEFAULT 'unknown',
    "last_seen_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incidents" (
    "id" UUID NOT NULL,
    "integration_id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "cause" VARCHAR(30) NOT NULL,
    "message" VARCHAR(200) NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(3),

    CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "establishment_id" UUID NOT NULL,
    "period" VARCHAR(7) NOT NULL,
    "plan_name" VARCHAR(40) NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "due_date" DATE NOT NULL,
    "status" "invoice_status" NOT NULL DEFAULT 'pending',
    "paid_at" TIMESTAMPTZ(3),
    "paid_by_id" UUID,
    "payment_note" VARCHAR(120),
    "last_notified_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "establishment_changes" (
    "id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "actor_id" UUID,
    "actor_name" VARCHAR(120) NOT NULL,
    "field" VARCHAR(40) NOT NULL,
    "old_value" JSONB,
    "new_value" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "establishment_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "app_notifications_dedupe_key_key" ON "app_notifications"("dedupe_key");

-- CreateIndex
CREATE INDEX "app_notifications_user_id_created_at_idx" ON "app_notifications"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "app_notifications_establishment_id_created_at_idx" ON "app_notifications"("establishment_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "cashback_rules_establishment_id_active_idx" ON "cashback_rules"("establishment_id", "active");

-- CreateIndex
CREATE INDEX "cashback_ledger_user_id_created_at_idx" ON "cashback_ledger"("user_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "cashback_ledger_order_id_type_key" ON "cashback_ledger"("order_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "coupons_establishment_id_code_key" ON "coupons"("establishment_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "coupon_redemptions_order_id_key" ON "coupon_redemptions"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "coupon_redemptions_coupon_id_user_id_key" ON "coupon_redemptions"("coupon_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "saved_payment_methods_token_key" ON "saved_payment_methods"("token");

-- CreateIndex
CREATE INDEX "saved_payment_methods_user_id_idx" ON "saved_payment_methods"("user_id");

-- CreateIndex
CREATE INDEX "bookings_establishment_id_starts_at_idx" ON "bookings"("establishment_id", "starts_at");

-- CreateIndex
CREATE INDEX "bookings_user_id_starts_at_idx" ON "bookings"("user_id", "starts_at" DESC);

-- CreateIndex
CREATE INDEX "bookings_table_id_starts_at_idx" ON "bookings"("table_id", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_order_id_key" ON "reviews"("order_id");

-- CreateIndex
CREATE INDEX "reviews_establishment_id_created_at_idx" ON "reviews"("establishment_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "share_visits_establishment_id_created_at_idx" ON "share_visits"("establishment_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ingredient_lots_expires_on_idx" ON "ingredient_lots"("expires_on");

-- CreateIndex
CREATE UNIQUE INDEX "ingredient_lots_ingredient_id_code_key" ON "ingredient_lots"("ingredient_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "support_tickets_number_key" ON "support_tickets"("number");

-- CreateIndex
CREATE INDEX "support_tickets_status_priority_created_at_idx" ON "support_tickets"("status", "priority", "created_at");

-- CreateIndex
CREATE INDEX "support_tickets_establishment_id_created_at_idx" ON "support_tickets"("establishment_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "support_messages_ticket_id_created_at_idx" ON "support_messages"("ticket_id", "created_at");

-- CreateIndex
CREATE INDEX "integrations_key_hash_idx" ON "integrations"("key_hash");

-- CreateIndex
CREATE UNIQUE INDEX "integrations_establishment_id_name_key" ON "integrations"("establishment_id", "name");

-- CreateIndex
CREATE INDEX "incidents_resolved_at_idx" ON "incidents"("resolved_at");

-- CreateIndex
CREATE INDEX "incidents_establishment_id_started_at_idx" ON "incidents"("establishment_id", "started_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "invoices_number_key" ON "invoices"("number");

-- CreateIndex
CREATE INDEX "invoices_status_due_date_idx" ON "invoices"("status", "due_date");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_establishment_id_period_key" ON "invoices"("establishment_id", "period");

-- CreateIndex
CREATE INDEX "establishment_changes_establishment_id_created_at_idx" ON "establishment_changes"("establishment_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "app_notifications" ADD CONSTRAINT "app_notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_notifications" ADD CONSTRAINT "app_notifications_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cashback_rules" ADD CONSTRAINT "cashback_rules_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cashback_rules" ADD CONSTRAINT "cashback_rules_promotion_id_fkey" FOREIGN KEY ("promotion_id") REFERENCES "promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cashback_ledger" ADD CONSTRAINT "cashback_ledger_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cashback_ledger" ADD CONSTRAINT "cashback_ledger_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "coupons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_payment_methods" ADD CONSTRAINT "saved_payment_methods_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_table_id_fkey" FOREIGN KEY ("table_id") REFERENCES "dining_tables"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "share_visits" ADD CONSTRAINT "share_visits_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingredient_lots" ADD CONSTRAINT "ingredient_lots_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "integrations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "establishment_changes" ADD CONSTRAINT "establishment_changes_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── Regras que o Prisma não expressa ───────────────────────────────────────

-- Avaliação (ficha 48): nota de 1 a 5; soma legada das notas já agregadas.
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_rating_range" CHECK ("rating" BETWEEN 1 AND 5);
UPDATE "establishments" SET "rating_sum" = ROUND("rating_average" * "rating_count");
ALTER TABLE "establishments" ADD CONSTRAINT "establishments_expiry_alert_days_min" CHECK ("expiry_alert_days" >= 3);

-- Cashback e cupom (fichas 15 e 56)
ALTER TABLE "cashback_rules" ADD CONSTRAINT "cashback_rules_percent_range" CHECK ("percent" BETWEEN 1 AND 50);
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_value_valid" CHECK (
  ("discount_type" = 'percent' AND "discount_value" BETWEEN 1 AND 100) OR ("discount_type" = 'fixed' AND "discount_value" > 0)
);
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_period_valid" CHECK ("ends_at" > "starts_at");
ALTER TABLE "orders" ADD CONSTRAINT "orders_discounts_nonnegative" CHECK ("cashback_used_cents" >= 0 AND "coupon_discount_cents" >= 0 AND "cashback_earn_cents" >= 0);

-- Métodos de pagamento salvos (ficha 49): um padrão por usuário, só cartão.
CREATE UNIQUE INDEX "saved_payment_methods_one_default" ON "saved_payment_methods" ("user_id") WHERE "is_default";
ALTER TABLE "saved_payment_methods" ADD CONSTRAINT "saved_payment_methods_card_only" CHECK ("kind" IN ('credit', 'debit'));

-- Reservas (ficha 30)
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_party_size_range" CHECK ("party_size" BETWEEN 1 AND 50);
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_period_valid" CHECK ("ends_at" > "starts_at");

-- Chamados de suporte (ficha 39)
CREATE INDEX "support_tickets_queue" ON "support_tickets" ("status", "priority", "created_at") WHERE "status" <> 'resolved';

-- Incidentes (ficha 33): um aberto por integração; histórico nunca é apagado nem reescrito (só `resolved_at` fecha).
CREATE UNIQUE INDEX "incidents_one_open" ON "incidents" ("integration_id") WHERE "resolved_at" IS NULL;

CREATE FUNCTION "incidents_guard"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'O histórico de incidentes não pode ser apagado.';
  END IF;
  IF NEW."integration_id" IS DISTINCT FROM OLD."integration_id"
     OR NEW."establishment_id" IS DISTINCT FROM OLD."establishment_id"
     OR NEW."cause" IS DISTINCT FROM OLD."cause"
     OR NEW."message" IS DISTINCT FROM OLD."message"
     OR NEW."started_at" IS DISTINCT FROM OLD."started_at"
     OR (OLD."resolved_at" IS NOT NULL AND NEW."resolved_at" IS DISTINCT FROM OLD."resolved_at") THEN
    RAISE EXCEPTION 'O histórico de incidentes só pode ser encerrado, nunca reescrito.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "incidents_guard_trg" BEFORE UPDATE OR DELETE ON "incidents" FOR EACH ROW EXECUTE FUNCTION "incidents_guard"();

-- Histórico de alterações do estabelecimento (ficha 66): somente inserção.
CREATE FUNCTION "establishment_changes_immutable"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'O histórico de alterações do estabelecimento é imutável.';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "establishment_changes_immutable_trg" BEFORE UPDATE OR DELETE ON "establishment_changes" FOR EACH ROW EXECUTE FUNCTION "establishment_changes_immutable"();

-- Faturas (ficha 38)
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_amount_nonnegative" CHECK ("amount_cents" >= 0);

-- Alertas de validade (ficha 70): um alerta aberto por (tipo, referência) já é garantido pelo índice parcial de staff_alerts.

-- Item do cardápio: sem dois itens ativos com o mesmo nome na mesma categoria (ficha 67).
-- (Duplicidades antigas, se existirem, são renomeadas para não impedir a criação do índice.)
WITH ranked AS (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "category_id", lower("name") ORDER BY "created_at", "id") AS rn
  FROM "menu_items" WHERE "deleted_at" IS NULL
)
UPDATE "menu_items" m SET "name" = LEFT(m."name", 70) || ' (' || r.rn || ')'
FROM ranked r WHERE m."id" = r."id" AND r.rn > 1;
CREATE UNIQUE INDEX "menu_items_unique_active_name" ON "menu_items" ("category_id", lower("name")) WHERE "deleted_at" IS NULL;

-- Permissões padrão das novas funções para a equipe e os admins já cadastrados (não remove nem altera nenhuma existente).
INSERT INTO "user_permissions" ("user_id", "permission")
SELECT u."id", perm FROM "users" u, unnest(ARRAY['reservations.manage', 'reports.view', 'support.request', 'billing.view']) AS perm
WHERE u."role" = 'manager'
ON CONFLICT DO NOTHING;
INSERT INTO "user_permissions" ("user_id", "permission")
SELECT u."id", 'reservations.manage' FROM "users" u WHERE u."role" = 'attendant'
ON CONFLICT DO NOTHING;
INSERT INTO "user_permissions" ("user_id", "permission")
SELECT u."id", perm FROM "users" u, unnest(ARRAY['platform.support', 'platform.billing', 'platform.monitoring']) AS perm
WHERE u."role" = 'admin'
ON CONFLICT DO NOTHING;
