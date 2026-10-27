-- CreateEnum
CREATE TYPE "staff_alert_kind" AS ENUM ('printer_offline', 'low_stock');

-- CreateEnum
CREATE TYPE "tab_status" AS ENUM ('open', 'closed');

-- CreateEnum
CREATE TYPE "loyalty_entry_type" AS ENUM ('earn', 'redeem', 'redeem_return', 'earn_reversal');

-- AlterTable
ALTER TABLE "ingredients" ADD COLUMN     "min_stock_quantity" DECIMAL(14,4) NOT NULL DEFAULT 0,
ADD COLUMN     "stock_quantity" DECIMAL(14,4);

-- AlterTable
ALTER TABLE "menu_items" ADD COLUMN     "station_id" UUID;

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "ready_at" TIMESTAMPTZ(3),
ADD COLUMN     "station_id" UUID;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "cancel_reason" VARCHAR(60),
ADD COLUMN     "cancelled_at" TIMESTAMPTZ(3),
ADD COLUMN     "cancelled_by_id" UUID,
ADD COLUMN     "delivered_at" TIMESTAMPTZ(3),
ADD COLUMN     "discount_cents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "estimate_adjusted_at" TIMESTAMPTZ(3),
ADD COLUMN     "estimate_adjusted_by_id" UUID,
ADD COLUMN     "estimated_minutes_override" INTEGER,
ADD COLUMN     "paid_at" TIMESTAMPTZ(3),
ADD COLUMN     "preparing_at" TIMESTAMPTZ(3),
ADD COLUMN     "ready_at" TIMESTAMPTZ(3),
ADD COLUMN     "redeemed_points" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "stock_consumed_at" TIMESTAMPTZ(3),
ADD COLUMN     "tab_id" UUID,
ADD COLUMN     "tab_settled_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "onboarding_completed_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "kitchen_stations" (
    "id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "name" VARCHAR(40) NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "kitchen_stations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "printers" (
    "id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "station_id" UUID,
    "name" VARCHAR(60) NOT NULL,
    "key_hash" CHAR(64) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "printers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_alerts" (
    "id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "kind" "staff_alert_kind" NOT NULL,
    "ref_id" UUID NOT NULL,
    "message" VARCHAR(200) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(3),

    CONSTRAINT "staff_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shifts" (
    "id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "opened_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMPTZ(3),
    "opened_by_id" UUID,
    "closed_by_id" UUID,

    CONSTRAINT "shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tabs" (
    "id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "table_id" UUID,
    "scope_key" VARCHAR(40) NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "status" "tab_status" NOT NULL DEFAULT 'open',
    "opened_by_id" UUID,
    "closed_by_id" UUID,
    "opened_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMPTZ(3),
    "closed_total_cents" INTEGER,
    "closed_paid_before_cents" INTEGER,
    "closed_charged_cents" INTEGER,

    CONSTRAINT "tabs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tab_payments" (
    "id" UUID NOT NULL,
    "tab_id" UUID NOT NULL,
    "idempotency_key" VARCHAR(64) NOT NULL,
    "method" "payment_method" NOT NULL,
    "status" "payment_status" NOT NULL DEFAULT 'pending',
    "amount_cents" INTEGER NOT NULL,
    "provider_payment_id" VARCHAR(64),
    "failure_reason" VARCHAR(120),
    "created_by_id" UUID,
    "approved_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tab_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_notifications" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "channel" VARCHAR(20) NOT NULL,
    "kind" VARCHAR(30) NOT NULL DEFAULT 'order_ready',
    "status" "notification_status" NOT NULL,
    "provider" VARCHAR(40) NOT NULL,
    "destination_masked" VARCHAR(40),
    "error_code" VARCHAR(40),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_ledger" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "type" "loyalty_entry_type" NOT NULL,
    "points" INTEGER NOT NULL,
    "note" VARCHAR(120),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loyalty_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL,
    "ingredient_id" UUID NOT NULL,
    "order_id" UUID,
    "quantity" DECIMAL(14,4) NOT NULL,
    "balance_after" DECIMAL(14,4) NOT NULL,
    "reason" VARCHAR(20) NOT NULL,
    "actor_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "kitchen_stations_establishment_id_name_key" ON "kitchen_stations"("establishment_id", "name");

-- CreateIndex
CREATE INDEX "printers_key_hash_idx" ON "printers"("key_hash");

-- CreateIndex
CREATE UNIQUE INDEX "printers_establishment_id_name_key" ON "printers"("establishment_id", "name");

-- CreateIndex
CREATE INDEX "staff_alerts_establishment_id_resolved_at_idx" ON "staff_alerts"("establishment_id", "resolved_at");

-- CreateIndex
CREATE INDEX "shifts_establishment_id_opened_at_idx" ON "shifts"("establishment_id", "opened_at" DESC);

-- CreateIndex
CREATE INDEX "tabs_establishment_id_status_idx" ON "tabs"("establishment_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "tab_payments_provider_payment_id_key" ON "tab_payments"("provider_payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "tab_payments_tab_id_idempotency_key_key" ON "tab_payments"("tab_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "order_notifications_order_id_kind_channel_key" ON "order_notifications"("order_id", "kind", "channel");

-- CreateIndex
CREATE INDEX "loyalty_ledger_user_id_created_at_idx" ON "loyalty_ledger"("user_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_ledger_order_id_type_key" ON "loyalty_ledger"("order_id", "type");

-- CreateIndex
CREATE INDEX "stock_movements_ingredient_id_created_at_idx" ON "stock_movements"("ingredient_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "order_items_station_id_idx" ON "order_items"("station_id");

-- CreateIndex
CREATE INDEX "orders_tab_id_idx" ON "orders"("tab_id");

-- AddForeignKey
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "kitchen_stations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_tab_id_fkey" FOREIGN KEY ("tab_id") REFERENCES "tabs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "kitchen_stations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kitchen_stations" ADD CONSTRAINT "kitchen_stations_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "printers" ADD CONSTRAINT "printers_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "printers" ADD CONSTRAINT "printers_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "kitchen_stations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_alerts" ADD CONSTRAINT "staff_alerts_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tabs" ADD CONSTRAINT "tabs_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tabs" ADD CONSTRAINT "tabs_table_id_fkey" FOREIGN KEY ("table_id") REFERENCES "dining_tables"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tab_payments" ADD CONSTRAINT "tab_payments_tab_id_fkey" FOREIGN KEY ("tab_id") REFERENCES "tabs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_notifications" ADD CONSTRAINT "order_notifications_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_ledger" ADD CONSTRAINT "loyalty_ledger_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_ledger" ADD CONSTRAINT "loyalty_ledger_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Índices parciais (invariantes que o Prisma não expressa)
-- Um alerta aberto por (estabelecimento, tipo, referência): sem repetir enquanto aberto.
CREATE UNIQUE INDEX "staff_alerts_open_unique" ON "staff_alerts"("establishment_id", "kind", "ref_id") WHERE "resolved_at" IS NULL;
-- Um turno aberto por estabelecimento.
CREATE UNIQUE INDEX "shifts_open_unique" ON "shifts"("establishment_id") WHERE "closed_at" IS NULL;
-- Uma comanda aberta por mesa/grupo.
CREATE UNIQUE INDEX "tabs_open_scope_unique" ON "tabs"("establishment_id", "scope_key") WHERE "status" = 'open';
-- No máximo uma cobrança pendente/aprovada por comanda.
CREATE UNIQUE INDEX "tab_payments_open_unique" ON "tab_payments"("tab_id") WHERE "status" IN ('pending', 'approved');
-- Baixa de estoque: uma por (pedido, insumo) → idempotente.
CREATE UNIQUE INDEX "stock_movements_order_ingredient_unique" ON "stock_movements"("order_id", "ingredient_id") WHERE "order_id" IS NOT NULL;

-- Integridade de valores
ALTER TABLE "orders" ADD CONSTRAINT "orders_estimate_override_range" CHECK ("estimated_minutes_override" IS NULL OR ("estimated_minutes_override" BETWEEN 1 AND 240));
ALTER TABLE "orders" ADD CONSTRAINT "orders_discount_valid" CHECK ("discount_cents" >= 0 AND "redeemed_points" >= 0);
ALTER TABLE "ingredients" ADD CONSTRAINT "ingredients_stock_nonnegative" CHECK (("stock_quantity" IS NULL OR "stock_quantity" >= 0) AND "min_stock_quantity" >= 0);

-- Preenche os carimbos novos dos pedidos já existentes (só lê dados existentes; nada é apagado).
UPDATE "orders" o SET "paid_at" = p."approved_at"
FROM "payments" p
WHERE p."order_id" = o."id" AND p."approved_at" IS NOT NULL AND o."paid_at" IS NULL;
UPDATE "orders" SET "delivered_at" = "updated_at" WHERE "status" = 'delivered' AND "delivered_at" IS NULL;
UPDATE "orders" SET "cancelled_at" = "updated_at" WHERE "status" = 'cancelled' AND "cancelled_at" IS NULL;

-- Permissões padrão das novas funções para a equipe já cadastrada (não remove nem altera nenhuma existente).
INSERT INTO "user_permissions" ("user_id", "permission")
SELECT u."id", perm FROM "users" u, unnest(ARRAY['orders.estimate', 'kitchen.manage', 'shift.manage', 'tabs.manage', 'stock.manage', 'dashboard.view']) AS perm
WHERE u."role" = 'manager'
ON CONFLICT DO NOTHING;
INSERT INTO "user_permissions" ("user_id", "permission")
SELECT u."id", 'tabs.manage' FROM "users" u WHERE u."role" = 'attendant'
ON CONFLICT DO NOTHING;
