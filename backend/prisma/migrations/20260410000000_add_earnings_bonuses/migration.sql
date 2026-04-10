-- CreateTable
CREATE TABLE "earnings_bonuses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "driver_id" UUID NOT NULL,
    "bonus_uuid" VARCHAR(100) NOT NULL,
    "region" "Region" NOT NULL,
    "activity_type" VARCHAR(50) NOT NULL,
    "activity_title" VARCHAR(200) NOT NULL,
    "formatted_total" VARCHAR(50) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" VARCHAR(10) NOT NULL,
    "recognized_at" TIMESTAMPTZ NOT NULL,
    "source" VARCHAR(30),
    "raw_payload" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "earnings_bonuses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_driver_bonus" ON "earnings_bonuses"("driver_id", "bonus_uuid");

-- CreateIndex
CREATE INDEX "idx_bonus_uuid" ON "earnings_bonuses"("bonus_uuid");

-- CreateIndex
CREATE INDEX "idx_bonus_driver_date" ON "earnings_bonuses"("driver_id", "recognized_at" DESC);

-- CreateIndex
CREATE INDEX "idx_bonus_region_type" ON "earnings_bonuses"("region", "activity_type");

-- AddForeignKey
ALTER TABLE "earnings_bonuses" ADD CONSTRAINT "earnings_bonuses_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
