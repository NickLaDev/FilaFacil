-- CreateEnum
CREATE TYPE "webauthn_purpose" AS ENUM ('registration', 'authentication');


-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "otp_purpose" ADD VALUE 'password_reset';
ALTER TYPE "otp_purpose" ADD VALUE 'account_deletion';

-- AlterTable
ALTER TABLE "dining_tables" ADD COLUMN     "group_id" UUID;

-- AlterTable
ALTER TABLE "menu_items" ADD COLUMN     "highlighted" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "deleted_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "passkeys" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "credential_id" VARCHAR(512) NOT NULL,
    "public_key" BYTEA NOT NULL,
    "counter" BIGINT NOT NULL DEFAULT 0,
    "transports" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "device_name" VARCHAR(60) NOT NULL DEFAULT 'Este aparelho',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(3),

    CONSTRAINT "passkeys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webauthn_challenges" (
    "id" UUID NOT NULL,
    "purpose" "webauthn_purpose" NOT NULL,
    "user_id" UUID,
    "challenge" VARCHAR(256) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webauthn_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "favorites" (
    "user_id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "favorites_pkey" PRIMARY KEY ("user_id","establishment_id")
);

-- CreateTable
CREATE TABLE "menu_item_rankings" (
    "menu_item_id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "rank" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "calculated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "menu_item_rankings_pkey" PRIMARY KEY ("menu_item_id")
);

-- CreateTable
CREATE TABLE "table_groups" (
    "id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "table_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "table_calls" (
    "id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "table_id" UUID NOT NULL,
    "user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(3),
    "resolved_by_id" UUID,

    CONSTRAINT "table_calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "table_reservations" (
    "id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "table_id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "party_size" SMALLINT NOT NULL,
    "reserved_at" TIMESTAMPTZ(3) NOT NULL,
    "closed_at" TIMESTAMPTZ(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "table_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "passkeys_credential_id_key" ON "passkeys"("credential_id");

-- CreateIndex
CREATE INDEX "passkeys_user_id_idx" ON "passkeys"("user_id");

-- CreateIndex
CREATE INDEX "webauthn_challenges_expires_at_idx" ON "webauthn_challenges"("expires_at");

-- CreateIndex
CREATE INDEX "favorites_user_id_created_at_idx" ON "favorites"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "menu_item_rankings_establishment_id_rank_idx" ON "menu_item_rankings"("establishment_id", "rank");

-- CreateIndex
CREATE INDEX "table_groups_establishment_id_idx" ON "table_groups"("establishment_id");

-- CreateIndex
CREATE INDEX "table_calls_table_id_resolved_at_idx" ON "table_calls"("table_id", "resolved_at");

-- CreateIndex
CREATE INDEX "table_calls_establishment_id_resolved_at_idx" ON "table_calls"("establishment_id", "resolved_at");

-- CreateIndex
CREATE INDEX "table_reservations_table_id_closed_at_idx" ON "table_reservations"("table_id", "closed_at");

-- CreateIndex
CREATE INDEX "table_reservations_establishment_id_closed_at_idx" ON "table_reservations"("establishment_id", "closed_at");

-- CreateIndex
CREATE INDEX "dining_tables_group_id_idx" ON "dining_tables"("group_id");

-- AddForeignKey
ALTER TABLE "passkeys" ADD CONSTRAINT "passkeys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webauthn_challenges" ADD CONSTRAINT "webauthn_challenges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_item_rankings" ADD CONSTRAINT "menu_item_rankings_menu_item_id_fkey" FOREIGN KEY ("menu_item_id") REFERENCES "menu_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_item_rankings" ADD CONSTRAINT "menu_item_rankings_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dining_tables" ADD CONSTRAINT "dining_tables_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "table_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "table_groups" ADD CONSTRAINT "table_groups_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "table_calls" ADD CONSTRAINT "table_calls_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "table_calls" ADD CONSTRAINT "table_calls_table_id_fkey" FOREIGN KEY ("table_id") REFERENCES "dining_tables"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "table_calls" ADD CONSTRAINT "table_calls_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "table_reservations" ADD CONSTRAINT "table_reservations_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "table_reservations" ADD CONSTRAINT "table_reservations_table_id_fkey" FOREIGN KEY ("table_id") REFERENCES "dining_tables"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- No máximo um chamado aberto por mesa e uma reserva ativa por mesa.
CREATE UNIQUE INDEX "table_calls_one_open_per_table" ON "table_calls" ("table_id") WHERE "resolved_at" IS NULL;
CREATE UNIQUE INDEX "table_reservations_one_active_per_table" ON "table_reservations" ("table_id") WHERE "closed_at" IS NULL;
