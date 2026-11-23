-- CreateEnum
CREATE TYPE "invoice_kind" AS ENUM ('monthly', 'proration', 'credit');

-- CreateEnum
CREATE TYPE "organization_role" AS ENUM ('admin', 'viewer');

-- CreateEnum
CREATE TYPE "partner_application_status" AS ENUM ('pending', 'needs_info', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "customer_segment" AS ENUM ('birthday', 'inactive', 'frequent');

-- AlterEnum
ALTER TYPE "integration_kind" ADD VALUE 'payment';

-- DropIndex
DROP INDEX "invoices_establishment_id_period_key";

-- AlterTable
ALTER TABLE "coupons" ADD COLUMN     "restricted_to_user_id" UUID;

-- AlterTable
ALTER TABLE "establishment_memberships" ADD COLUMN     "organization_id" UUID;

-- AlterTable
ALTER TABLE "integrations" ADD COLUMN     "enabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "health_url" VARCHAR(300);

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "kind" "invoice_kind" NOT NULL DEFAULT 'monthly';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "birth_date" DATE;

-- CreateTable
CREATE TABLE "organization_members" (
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "organization_role" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_members_pkey" PRIMARY KEY ("organization_id","user_id")
);

-- CreateTable
CREATE TABLE "integration_checks" (
    "id" UUID NOT NULL,
    "integration_id" UUID NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "latency_ms" INTEGER,
    "error" VARCHAR(200),
    "trigger" VARCHAR(20) NOT NULL,
    "actor_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integration_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actor_id" UUID,
    "actor_name" VARCHAR(120) NOT NULL,
    "actor_role" VARCHAR(20),
    "action" VARCHAR(60) NOT NULL,
    "target_type" VARCHAR(40) NOT NULL,
    "target_id" VARCHAR(64),
    "summary" VARCHAR(300) NOT NULL,
    "details" JSONB,
    "ip_address" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_settings" (
    "key" VARCHAR(60) NOT NULL,
    "value" JSONB NOT NULL,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "access_logs" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "session_id" UUID,
    "ip_address" VARCHAR(64),
    "user_agent" VARCHAR(255),
    "device_hash" CHAR(64) NOT NULL,
    "device_label" VARCHAR(80) NOT NULL,
    "method" VARCHAR(20) NOT NULL,
    "new_device" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "access_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_applications" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "status" "partner_application_status" NOT NULL DEFAULT 'pending',
    "business_name" VARCHAR(80) NOT NULL,
    "type" "establishment_type" NOT NULL,
    "document" VARCHAR(18) NOT NULL,
    "city" VARCHAR(60) NOT NULL,
    "address" VARCHAR(160) NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "opens_at" INTEGER NOT NULL,
    "closes_at" INTEGER NOT NULL,
    "contact_name" VARCHAR(120) NOT NULL,
    "contact_email" VARCHAR(254) NOT NULL,
    "contact_phone" VARCHAR(11) NOT NULL,
    "notes" VARCHAR(1000) NOT NULL DEFAULT '',
    "info_request" VARCHAR(1000),
    "decision_reason" VARCHAR(1000),
    "tracking_token_hash" CHAR(64) NOT NULL,
    "establishment_id" UUID,
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "partner_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_documents" (
    "id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "file_name" VARCHAR(120) NOT NULL,
    "content_type" VARCHAR(40) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "storage_key" VARCHAR(80) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_changes" (
    "id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "from_plan_name" VARCHAR(40) NOT NULL,
    "to_plan_id" UUID NOT NULL,
    "to_plan_name" VARCHAR(40) NOT NULL,
    "proration_cents" INTEGER NOT NULL,
    "invoice_id" UUID,
    "actor_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "segment_campaigns" (
    "id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "segment" "customer_segment" NOT NULL,
    "threshold" INTEGER NOT NULL DEFAULT 0,
    "discount_type" "coupon_discount_type" NOT NULL,
    "discount_value" INTEGER NOT NULL,
    "valid_days" INTEGER NOT NULL,
    "message" VARCHAR(200) NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "segment_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_grants" (
    "id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "coupon_id" UUID NOT NULL,
    "period_key" VARCHAR(20) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_grants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "organization_members_user_id_idx" ON "organization_members"("user_id");

-- CreateIndex
CREATE INDEX "integration_checks_integration_id_created_at_idx" ON "integration_checks"("integration_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_created_at_idx" ON "audit_logs"("actor_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_action_created_at_idx" ON "audit_logs"("action", "created_at" DESC);

-- CreateIndex
CREATE INDEX "access_logs_user_id_created_at_idx" ON "access_logs"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "access_logs_user_id_device_hash_idx" ON "access_logs"("user_id", "device_hash");

-- CreateIndex
CREATE INDEX "access_logs_created_at_idx" ON "access_logs"("created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "partner_applications_number_key" ON "partner_applications"("number");

-- CreateIndex
CREATE UNIQUE INDEX "partner_applications_tracking_token_hash_key" ON "partner_applications"("tracking_token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "partner_applications_establishment_id_key" ON "partner_applications"("establishment_id");

-- CreateIndex
CREATE INDEX "partner_applications_status_created_at_idx" ON "partner_applications"("status", "created_at");

-- CreateIndex
CREATE INDEX "partner_documents_application_id_idx" ON "partner_documents"("application_id");

-- CreateIndex
CREATE INDEX "plan_changes_establishment_id_created_at_idx" ON "plan_changes"("establishment_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "segment_campaigns_establishment_id_active_idx" ON "segment_campaigns"("establishment_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_grants_coupon_id_key" ON "campaign_grants"("coupon_id");

-- CreateIndex
CREATE INDEX "campaign_grants_user_id_idx" ON "campaign_grants"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_grants_campaign_id_user_id_period_key_key" ON "campaign_grants"("campaign_id", "user_id", "period_key");

-- CreateIndex
CREATE INDEX "invoices_establishment_id_period_idx" ON "invoices"("establishment_id", "period");

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_checks" ADD CONSTRAINT "integration_checks_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_logs" ADD CONSTRAINT "access_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_applications" ADD CONSTRAINT "partner_applications_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_documents" ADD CONSTRAINT "partner_documents_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "partner_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_changes" ADD CONSTRAINT "plan_changes_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "segment_campaigns" ADD CONSTRAINT "segment_campaigns_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_grants" ADD CONSTRAINT "campaign_grants_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "segment_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_grants" ADD CONSTRAINT "campaign_grants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_grants" ADD CONSTRAINT "campaign_grants_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "coupons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── Regras que o Prisma não expressa ───────────────────────────────────────

-- Faturas (fichas 38/58): uma mensalidade por casa+mês; ajustes de troca de plano podem ser vários.
CREATE UNIQUE INDEX "invoices_one_monthly_per_period" ON "invoices" ("establishment_id", "period") WHERE "kind" = 'monthly';
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_amount_nonnegative";
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_amount_sign" CHECK (("kind" = 'credit' AND "amount_cents" < 0) OR ("kind" <> 'credit' AND "amount_cents" >= 0));

-- Auditoria (ficha 42): somente inserção.
CREATE FUNCTION "audit_logs_immutable"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'O log de auditoria é imutável.';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "audit_logs_immutable_trg" BEFORE UPDATE OR DELETE ON "audit_logs" FOR EACH ROW EXECUTE FUNCTION "audit_logs_immutable"();

-- Parceiros (ficha 55)
ALTER TABLE "partner_applications" ADD CONSTRAINT "partner_hours_valid" CHECK ("opens_at" BETWEEN 0 AND 1439 AND "closes_at" BETWEEN 1 AND 1440);

-- Campanhas (ficha 68)
ALTER TABLE "segment_campaigns" ADD CONSTRAINT "segment_campaigns_valid" CHECK ("threshold" >= 0 AND "valid_days" BETWEEN 1 AND 90 AND "discount_value" > 0);

-- Permissões novas para quem já existe.
INSERT INTO "user_permissions" ("user_id", "permission")
SELECT u."id", 'plan.manage' FROM "users" u WHERE u."role" = 'manager'
ON CONFLICT DO NOTHING;
INSERT INTO "user_permissions" ("user_id", "permission")
SELECT u."id", perm FROM "users" u, unnest(ARRAY['platform.audit', 'platform.settings', 'platform.partners']) AS perm
WHERE u."role" = 'admin'
ON CONFLICT DO NOTHING;
