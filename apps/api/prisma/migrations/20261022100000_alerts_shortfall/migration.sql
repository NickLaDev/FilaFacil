-- Ruptura de estoque sinalizada e alerta dispensado sem reabrir (aditivo).
ALTER TYPE "staff_alert_kind" ADD VALUE 'stock_shortfall';
ALTER TABLE "staff_alerts" ADD COLUMN "dismissed_at" TIMESTAMPTZ(3);
ALTER TABLE "stock_movements" ADD COLUMN "shortfall" DECIMAL(14,4) NOT NULL DEFAULT 0;
