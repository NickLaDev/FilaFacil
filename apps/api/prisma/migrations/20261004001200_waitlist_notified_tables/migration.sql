-- AlterTable
ALTER TABLE "waitlist_entries" ADD COLUMN     "notified_table_ids" UUID[] DEFAULT ARRAY[]::UUID[];
