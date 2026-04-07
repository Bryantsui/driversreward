-- AlterTable
ALTER TABLE "trips" ADD COLUMN     "fare_breakdown" JSONB,
ADD COLUMN     "status_type" VARCHAR(50),
ADD COLUMN     "trip_notes" TEXT;
