-- CreateEnum
CREATE TYPE "otp_purpose" AS ENUM ('login', 'contact_verification');

-- CreateEnum
CREATE TYPE "order_status" AS ENUM ('received', 'paid', 'preparing', 'ready', 'delivered', 'cancelled');

-- CreateEnum
CREATE TYPE "payment_method" AS ENUM ('pix', 'credit', 'debit');

-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('pending', 'approved', 'refused', 'expired', 'cancelled', 'refunded');

-- AlterTable
ALTER TABLE "establishments" ADD COLUMN     "pickup_point" VARCHAR(60) NOT NULL DEFAULT 'Balcão';

-- AlterTable
ALTER TABLE "otp_challenges" ADD COLUMN     "purpose" "otp_purpose" NOT NULL DEFAULT 'login',
ADD COLUMN     "user_id" UUID;

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "user_id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "table_id" UUID,
    "table_label" VARCHAR(30),
    "client_request_id" VARCHAR(64),
    "status" "order_status" NOT NULL DEFAULT 'received',
    "total_cents" INTEGER NOT NULL,
    "pickup_code" CHAR(4) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "menu_item_id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "unit_price_cents" INTEGER NOT NULL,
    "quantity" SMALLINT NOT NULL,
    "notes" VARCHAR(200) NOT NULL DEFAULT '',

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "attempt" INTEGER NOT NULL,
    "method" "payment_method" NOT NULL,
    "status" "payment_status" NOT NULL DEFAULT 'pending',
    "amount_cents" INTEGER NOT NULL,
    "provider_payment_id" VARCHAR(64),
    "pix_copy_paste" TEXT,
    "pix_qr_base64" TEXT,
    "pix_expires_at" TIMESTAMPTZ(3),
    "failure_reason" VARCHAR(120),
    "approved_at" TIMESTAMPTZ(3),
    "refunded_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "orders_number_key" ON "orders"("number");

-- CreateIndex
CREATE INDEX "orders_user_id_created_at_idx" ON "orders"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "orders_establishment_id_status_created_at_idx" ON "orders"("establishment_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "orders_user_id_client_request_id_key" ON "orders"("user_id", "client_request_id");

-- CreateIndex
CREATE INDEX "order_items_order_id_idx" ON "order_items"("order_id");

-- CreateIndex
CREATE INDEX "order_items_menu_item_id_idx" ON "order_items"("menu_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_provider_payment_id_key" ON "payments"("provider_payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_order_id_attempt_key" ON "payments"("order_id", "attempt");

-- CreateIndex
CREATE INDEX "otp_challenges_user_id_idx" ON "otp_challenges"("user_id");

-- AddForeignKey
ALTER TABLE "otp_challenges" ADD CONSTRAINT "otp_challenges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_table_id_fkey" FOREIGN KEY ("table_id") REFERENCES "dining_tables"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_menu_item_id_fkey" FOREIGN KEY ("menu_item_id") REFERENCES "menu_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- No máximo um pagamento em andamento ou aprovado por pedido (evita cobrança em duplicidade).
CREATE UNIQUE INDEX "payments_one_open_per_order" ON "payments"("order_id") WHERE "status" IN ('pending', 'approved');

-- Permissões novas (Sprint 2): equipe já cadastrada passa a ver pedidos; só gestores estornam.
INSERT INTO "user_permissions" ("user_id", "permission")
SELECT "id", 'orders.manage' FROM "users" WHERE "role" IN ('attendant', 'manager')
ON CONFLICT DO NOTHING;
INSERT INTO "user_permissions" ("user_id", "permission")
SELECT "id", 'orders.refund' FROM "users" WHERE "role" = 'manager'
ON CONFLICT DO NOTHING;
