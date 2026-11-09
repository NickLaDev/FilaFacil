-- O catálogo de permissões cresceu: a descrição do histórico lista todas as permissões alteradas.
ALTER TABLE "permission_audit_logs" ALTER COLUMN "description" TYPE VARCHAR(2000);
