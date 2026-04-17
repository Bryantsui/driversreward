ALTER TABLE "trips" ADD COLUMN "customer_payment" DECIMAL(12,2) DEFAULT 0;
ALTER TABLE "trips" ADD COLUMN "uber_service_fee" DECIMAL(12,2) DEFAULT 0;
ALTER TABLE "trips" ADD COLUMN "cash_collected" DECIMAL(12,2) DEFAULT 0;
ALTER TABLE "trips" ADD COLUMN "trip_balance" DECIMAL(12,2) DEFAULT 0;
ALTER TABLE "trips" ADD COLUMN "upfront_fare" DECIMAL(12,2) DEFAULT 0;
ALTER TABLE "trips" ADD COLUMN "commission_rate" DECIMAL(5,2);
