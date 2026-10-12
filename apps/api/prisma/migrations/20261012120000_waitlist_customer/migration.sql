-- Ficha 12: cliente entra na fila pelo botão "Reservar" (nulo quando a equipe cadastrou o grupo).
ALTER TABLE "waitlist_entries" ADD COLUMN "customer_id" UUID;

CREATE INDEX "waitlist_entries_customer_id_status_idx" ON "waitlist_entries"("customer_id", "status");

-- Um cliente só pode ter uma entrada ativa por estabelecimento (protege contra cliques/aparelhos simultâneos).
CREATE UNIQUE INDEX "waitlist_entries_active_customer_key" ON "waitlist_entries"("establishment_id", "customer_id")
  WHERE "customer_id" IS NOT NULL AND "status" IN ('waiting', 'notified');

ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
