-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('client', 'attendant', 'manager', 'admin');

-- CreateEnum
CREATE TYPE "user_status" AS ENUM ('active', 'suspended');

-- CreateEnum
CREATE TYPE "otp_channel" AS ENUM ('phone', 'email');

-- CreateEnum
CREATE TYPE "auth_provider" AS ENUM ('google', 'apple');

-- CreateEnum
CREATE TYPE "plan_feature" AS ENUM ('floor_plan', 'waitlist', 'promotions', 'recipes', 'layout_duplication');

-- CreateEnum
CREATE TYPE "establishment_status" AS ENUM ('active', 'inactive', 'suspended');

-- CreateEnum
CREATE TYPE "establishment_type" AS ENUM ('bar', 'restaurant', 'canteen', 'snack_bar');

-- CreateEnum
CREATE TYPE "ingredient_unit" AS ENUM ('un', 'kg', 'g', 'L', 'ml');

-- CreateEnum
CREATE TYPE "table_shape" AS ENUM ('round', 'square', 'rect');

-- CreateEnum
CREATE TYPE "table_occupancy" AS ENUM ('free', 'occupied');

-- CreateEnum
CREATE TYPE "waitlist_status" AS ENUM ('waiting', 'notified', 'seated', 'removed');

-- CreateEnum
CREATE TYPE "notification_status" AS ENUM ('sent', 'failed', 'skipped');

-- CreateEnum
CREATE TYPE "permission_audit_action" AS ENUM ('role_changed', 'permissions_changed', 'memberships_changed', 'suspended', 'reactivated');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "email" VARCHAR(254),
    "phone" VARCHAR(11),
    "password_hash" TEXT,
    "cpf_hash" CHAR(64),
    "cpf_encrypted" TEXT,
    "cpf_masked" VARCHAR(14),
    "role" "user_role" NOT NULL DEFAULT 'client',
    "status" "user_status" NOT NULL DEFAULT 'active',
    "email_verified_at" TIMESTAMPTZ(3),
    "phone_verified_at" TIMESTAMPTZ(3),
    "terms_accepted_at" TIMESTAMPTZ(3),
    "marketing_opt_in" BOOLEAN NOT NULL DEFAULT false,
    "last_access_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_permissions" (
    "user_id" UUID NOT NULL,
    "permission" VARCHAR(64) NOT NULL,
    "granted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_permissions_pkey" PRIMARY KEY ("user_id","permission")
);

-- CreateTable
CREATE TABLE "establishment_memberships" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "establishment_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_addresses" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "label" VARCHAR(40) NOT NULL,
    "street" VARCHAR(160) NOT NULL,
    "city" VARCHAR(80) NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "refresh_token_hash" CHAR(64) NOT NULL,
    "previous_refresh_token_hash" CHAR(64),
    "rotated_at" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "last_used_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_reason" VARCHAR(40),
    "user_agent" VARCHAR(255),
    "ip_address" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_challenges" (
    "id" UUID NOT NULL,
    "channel" "otp_channel" NOT NULL,
    "destination" VARCHAR(254) NOT NULL,
    "code_hash" CHAR(64) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),
    "ip_address" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_accounts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" "auth_provider" NOT NULL,
    "provider_subject" VARCHAR(255) NOT NULL,
    "email" VARCHAR(254),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_states" (
    "state" VARCHAR(128) NOT NULL,
    "provider" "auth_provider" NOT NULL,
    "code_verifier" VARCHAR(128) NOT NULL,
    "nonce" VARCHAR(128) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_states_pkey" PRIMARY KEY ("state")
);

-- CreateTable
CREATE TABLE "plans" (
    "id" UUID NOT NULL,
    "name" VARCHAR(40) NOT NULL,
    "monthly_price_cents" INTEGER NOT NULL,
    "max_units" INTEGER NOT NULL,
    "max_tables" INTEGER NOT NULL,
    "max_staff" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_features" (
    "plan_id" UUID NOT NULL,
    "feature" "plan_feature" NOT NULL,

    CONSTRAINT "plan_features_pkey" PRIMARY KEY ("plan_id","feature")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "establishments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "type" "establishment_type" NOT NULL,
    "status" "establishment_status" NOT NULL DEFAULT 'active',
    "city" VARCHAR(60) NOT NULL,
    "address" VARCHAR(160) NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'America/Sao_Paulo',
    "food_categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rating_average" DECIMAL(2,1) NOT NULL DEFAULT 0,
    "rating_count" INTEGER NOT NULL DEFAULT 0,
    "average_wait_minutes" INTEGER NOT NULL DEFAULT 15,
    "orders_paused" BOOLEAN NOT NULL DEFAULT false,
    "high_demand" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "establishments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "establishment_photos" (
    "id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "url" VARCHAR(500) NOT NULL,
    "storage_key" VARCHAR(128),
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "establishment_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opening_hours" (
    "id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "weekday" SMALLINT NOT NULL,
    "opens_at" SMALLINT NOT NULL,
    "closes_at" SMALLINT NOT NULL,

    CONSTRAINT "opening_hours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_categories" (
    "id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "name" VARCHAR(40) NOT NULL,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "menu_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_items" (
    "id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "description" VARCHAR(200) NOT NULL DEFAULT '',
    "price_cents" INTEGER NOT NULL,
    "image_url" VARCHAR(500),
    "image_storage_key" VARCHAR(128),
    "available" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "menu_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_item_availability_changes" (
    "id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "menu_item_id" UUID NOT NULL,
    "item_name" VARCHAR(80) NOT NULL,
    "available" BOOLEAN NOT NULL,
    "changed_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "menu_item_availability_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotions" (
    "id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "discount_percent" SMALLINT NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "promotions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotion_items" (
    "promotion_id" UUID NOT NULL,
    "menu_item_id" UUID NOT NULL,

    CONSTRAINT "promotion_items_pkey" PRIMARY KEY ("promotion_id","menu_item_id")
);

-- CreateTable
CREATE TABLE "ingredients" (
    "id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "unit" "ingredient_unit" NOT NULL,
    "unit_cost" DECIMAL(12,4) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ingredients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "technical_sheets" (
    "id" UUID NOT NULL,
    "menu_item_id" UUID NOT NULL,
    "cost_limit_percent" DECIMAL(5,2) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "technical_sheets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "technical_sheet_items" (
    "technical_sheet_id" UUID NOT NULL,
    "ingredient_id" UUID NOT NULL,
    "quantity" DECIMAL(12,4) NOT NULL,

    CONSTRAINT "technical_sheet_items_pkey" PRIMARY KEY ("technical_sheet_id","ingredient_id")
);

-- CreateTable
CREATE TABLE "floor_plans" (
    "id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "floor_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dining_tables" (
    "id" UUID NOT NULL,
    "floor_plan_id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "label" VARCHAR(30) NOT NULL,
    "shape" "table_shape" NOT NULL,
    "capacity" SMALLINT NOT NULL,
    "position_x" DOUBLE PRECISION NOT NULL,
    "position_y" DOUBLE PRECISION NOT NULL,
    "qr_code" VARCHAR(32) NOT NULL,
    "occupancy" "table_occupancy" NOT NULL DEFAULT 'free',
    "occupied_party_size" SMALLINT,
    "occupied_since" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "dining_tables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waitlist_entries" (
    "id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "phone" VARCHAR(11) NOT NULL,
    "party_size" SMALLINT NOT NULL,
    "position" INTEGER NOT NULL,
    "status" "waitlist_status" NOT NULL DEFAULT 'waiting',
    "quoted_wait_minutes" INTEGER NOT NULL,
    "joined_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notified_at" TIMESTAMPTZ(3),
    "notified_table_label" VARCHAR(60),
    "closed_at" TIMESTAMPTZ(3),
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "waitlist_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waitlist_notifications" (
    "id" UUID NOT NULL,
    "entry_id" UUID NOT NULL,
    "channel" VARCHAR(20) NOT NULL,
    "destination_masked" VARCHAR(40) NOT NULL,
    "table_label" VARCHAR(60),
    "status" "notification_status" NOT NULL,
    "provider" VARCHAR(40) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "waitlist_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permission_audit_logs" (
    "id" UUID NOT NULL,
    "target_user_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "action" "permission_audit_action" NOT NULL,
    "description" VARCHAR(500) NOT NULL,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permission_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "users_cpf_hash_key" ON "users"("cpf_hash");

-- CreateIndex
CREATE INDEX "users_role_status_idx" ON "users"("role", "status");

-- CreateIndex
CREATE INDEX "users_created_at_idx" ON "users"("created_at");

-- CreateIndex
CREATE INDEX "establishment_memberships_establishment_id_idx" ON "establishment_memberships"("establishment_id");

-- CreateIndex
CREATE UNIQUE INDEX "establishment_memberships_user_id_establishment_id_key" ON "establishment_memberships"("user_id", "establishment_id");

-- CreateIndex
CREATE INDEX "user_addresses_user_id_idx" ON "user_addresses"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_refresh_token_hash_key" ON "sessions"("refresh_token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_previous_refresh_token_hash_idx" ON "sessions"("previous_refresh_token_hash");

-- CreateIndex
CREATE INDEX "otp_challenges_channel_destination_created_at_idx" ON "otp_challenges"("channel", "destination", "created_at");

-- CreateIndex
CREATE INDEX "auth_accounts_user_id_idx" ON "auth_accounts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_accounts_provider_provider_subject_key" ON "auth_accounts"("provider", "provider_subject");

-- CreateIndex
CREATE INDEX "oauth_states_expires_at_idx" ON "oauth_states"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "plans_name_key" ON "plans"("name");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_name_key" ON "organizations"("name");

-- CreateIndex
CREATE INDEX "establishments_status_latitude_longitude_idx" ON "establishments"("status", "latitude", "longitude");

-- CreateIndex
CREATE INDEX "establishments_organization_id_idx" ON "establishments"("organization_id");

-- CreateIndex
CREATE INDEX "establishments_plan_id_idx" ON "establishments"("plan_id");

-- CreateIndex
CREATE INDEX "establishment_photos_establishment_id_position_idx" ON "establishment_photos"("establishment_id", "position");

-- CreateIndex
CREATE INDEX "opening_hours_establishment_id_weekday_idx" ON "opening_hours"("establishment_id", "weekday");

-- CreateIndex
CREATE UNIQUE INDEX "menu_categories_establishment_id_name_key" ON "menu_categories"("establishment_id", "name");

-- CreateIndex
CREATE INDEX "menu_items_establishment_id_deleted_at_available_idx" ON "menu_items"("establishment_id", "deleted_at", "available");

-- CreateIndex
CREATE INDEX "menu_items_category_id_idx" ON "menu_items"("category_id");

-- CreateIndex
CREATE INDEX "menu_item_availability_changes_establishment_id_created_at_idx" ON "menu_item_availability_changes"("establishment_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "menu_item_availability_changes_menu_item_id_idx" ON "menu_item_availability_changes"("menu_item_id");

-- CreateIndex
CREATE INDEX "promotions_establishment_id_starts_at_ends_at_idx" ON "promotions"("establishment_id", "starts_at", "ends_at");

-- CreateIndex
CREATE INDEX "promotion_items_menu_item_id_idx" ON "promotion_items"("menu_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "ingredients_establishment_id_name_key" ON "ingredients"("establishment_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "technical_sheets_menu_item_id_key" ON "technical_sheets"("menu_item_id");

-- CreateIndex
CREATE INDEX "technical_sheet_items_ingredient_id_idx" ON "technical_sheet_items"("ingredient_id");

-- CreateIndex
CREATE UNIQUE INDEX "floor_plans_establishment_id_key" ON "floor_plans"("establishment_id");

-- CreateIndex
CREATE UNIQUE INDEX "dining_tables_qr_code_key" ON "dining_tables"("qr_code");

-- CreateIndex
CREATE INDEX "dining_tables_establishment_id_occupancy_idx" ON "dining_tables"("establishment_id", "occupancy");

-- CreateIndex
CREATE UNIQUE INDEX "dining_tables_floor_plan_id_label_key" ON "dining_tables"("floor_plan_id", "label");

-- CreateIndex
CREATE INDEX "waitlist_entries_establishment_id_status_position_idx" ON "waitlist_entries"("establishment_id", "status", "position");

-- CreateIndex
CREATE INDEX "waitlist_notifications_entry_id_idx" ON "waitlist_notifications"("entry_id");

-- CreateIndex
CREATE INDEX "permission_audit_logs_target_user_id_created_at_idx" ON "permission_audit_logs"("target_user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "permission_audit_logs_created_at_idx" ON "permission_audit_logs"("created_at" DESC);

-- AddForeignKey
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "establishment_memberships" ADD CONSTRAINT "establishment_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "establishment_memberships" ADD CONSTRAINT "establishment_memberships_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_addresses" ADD CONSTRAINT "user_addresses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_accounts" ADD CONSTRAINT "auth_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_features" ADD CONSTRAINT "plan_features_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "establishments" ADD CONSTRAINT "establishments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "establishments" ADD CONSTRAINT "establishments_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "establishment_photos" ADD CONSTRAINT "establishment_photos_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opening_hours" ADD CONSTRAINT "opening_hours_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_categories" ADD CONSTRAINT "menu_categories_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "menu_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_item_availability_changes" ADD CONSTRAINT "menu_item_availability_changes_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_item_availability_changes" ADD CONSTRAINT "menu_item_availability_changes_menu_item_id_fkey" FOREIGN KEY ("menu_item_id") REFERENCES "menu_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_item_availability_changes" ADD CONSTRAINT "menu_item_availability_changes_changed_by_id_fkey" FOREIGN KEY ("changed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_items" ADD CONSTRAINT "promotion_items_promotion_id_fkey" FOREIGN KEY ("promotion_id") REFERENCES "promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_items" ADD CONSTRAINT "promotion_items_menu_item_id_fkey" FOREIGN KEY ("menu_item_id") REFERENCES "menu_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingredients" ADD CONSTRAINT "ingredients_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "technical_sheets" ADD CONSTRAINT "technical_sheets_menu_item_id_fkey" FOREIGN KEY ("menu_item_id") REFERENCES "menu_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "technical_sheet_items" ADD CONSTRAINT "technical_sheet_items_technical_sheet_id_fkey" FOREIGN KEY ("technical_sheet_id") REFERENCES "technical_sheets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "technical_sheet_items" ADD CONSTRAINT "technical_sheet_items_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "floor_plans" ADD CONSTRAINT "floor_plans_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "floor_plans" ADD CONSTRAINT "floor_plans_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dining_tables" ADD CONSTRAINT "dining_tables_floor_plan_id_fkey" FOREIGN KEY ("floor_plan_id") REFERENCES "floor_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dining_tables" ADD CONSTRAINT "dining_tables_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waitlist_notifications" ADD CONSTRAINT "waitlist_notifications_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "waitlist_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permission_audit_logs" ADD CONSTRAINT "permission_audit_logs_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permission_audit_logs" ADD CONSTRAINT "permission_audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── Regras que o Prisma não expressa no schema ─────────────────────────────

-- No máximo um endereço padrão por usuário.
CREATE UNIQUE INDEX "user_addresses_one_default_per_user" ON "user_addresses"("user_id") WHERE "is_default";

-- Posição única entre as entradas ativas da fila de cada estabelecimento.
CREATE UNIQUE INDEX "waitlist_entries_active_position" ON "waitlist_entries"("establishment_id", "position")
  WHERE "status" IN ('waiting', 'notified');

-- Integridade de domínio (a API valida antes; o banco é a última barreira).
ALTER TABLE "users"
  ADD CONSTRAINT "users_email_lowercase" CHECK ("email" = lower("email")),
  ADD CONSTRAINT "users_phone_digits" CHECK ("phone" ~ '^[0-9]{10,11}$');

ALTER TABLE "plans"
  ADD CONSTRAINT "plans_price_non_negative" CHECK ("monthly_price_cents" >= 0),
  ADD CONSTRAINT "plans_limits_positive" CHECK ("max_units" >= 1 AND "max_tables" >= 1 AND "max_staff" >= 1);

ALTER TABLE "establishments"
  ADD CONSTRAINT "establishments_coordinates" CHECK ("latitude" BETWEEN -90 AND 90 AND "longitude" BETWEEN -180 AND 180),
  ADD CONSTRAINT "establishments_rating_range" CHECK ("rating_average" BETWEEN 0 AND 5 AND "rating_count" >= 0),
  ADD CONSTRAINT "establishments_wait_non_negative" CHECK ("average_wait_minutes" >= 0);

ALTER TABLE "opening_hours"
  ADD CONSTRAINT "opening_hours_range" CHECK (
    "weekday" BETWEEN 0 AND 6 AND "opens_at" BETWEEN 0 AND 1439 AND "closes_at" BETWEEN 0 AND 1440
  );

ALTER TABLE "menu_items"
  ADD CONSTRAINT "menu_items_price_range" CHECK ("price_cents" > 0 AND "price_cents" <= 1000000);

ALTER TABLE "promotions"
  ADD CONSTRAINT "promotions_discount_range" CHECK ("discount_percent" BETWEEN 1 AND 90),
  ADD CONSTRAINT "promotions_period" CHECK ("ends_at" > "starts_at");

ALTER TABLE "ingredients"
  ADD CONSTRAINT "ingredients_cost_non_negative" CHECK ("unit_cost" >= 0);

ALTER TABLE "technical_sheets"
  ADD CONSTRAINT "technical_sheets_limit_range" CHECK ("cost_limit_percent" > 0 AND "cost_limit_percent" <= 100);

ALTER TABLE "technical_sheet_items"
  ADD CONSTRAINT "technical_sheet_items_quantity_positive" CHECK ("quantity" > 0);

ALTER TABLE "dining_tables"
  ADD CONSTRAINT "dining_tables_capacity_range" CHECK ("capacity" BETWEEN 1 AND 30),
  ADD CONSTRAINT "dining_tables_position_range" CHECK ("position_x" BETWEEN 0 AND 100 AND "position_y" BETWEEN 0 AND 100);

ALTER TABLE "waitlist_entries"
  ADD CONSTRAINT "waitlist_entries_party_size_range" CHECK ("party_size" BETWEEN 1 AND 50),
  ADD CONSTRAINT "waitlist_entries_phone_digits" CHECK ("phone" ~ '^[0-9]{10,11}$');
