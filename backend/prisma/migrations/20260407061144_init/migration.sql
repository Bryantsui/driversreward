-- CreateEnum
CREATE TYPE "Region" AS ENUM ('HK', 'BR');

-- CreateEnum
CREATE TYPE "DriverStatus" AS ENUM ('PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'DELETED');

-- CreateEnum
CREATE TYPE "RedemptionStatus" AS ENUM ('PENDING', 'PROCESSING', 'FULFILLED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ConsentType" AS ENUM ('DATA_COLLECTION', 'MARKETING', 'DATA_SHARING');

-- CreateEnum
CREATE TYPE "TripReviewStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'FLAGGED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('SUPER_ADMIN', 'REVIEWER', 'VIEWER');

-- CreateTable
CREATE TABLE "drivers" (
    "id" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "phone" VARCHAR(50),
    "name_encrypted" BYTEA,
    "password_hash" VARCHAR(255) NOT NULL,
    "region" "Region" NOT NULL,
    "status" "DriverStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "points_balance" INTEGER NOT NULL DEFAULT 0,
    "lifetime_points" INTEGER NOT NULL DEFAULT 0,
    "referral_code" VARCHAR(20) NOT NULL,
    "referred_by" UUID,
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "phone_verified" BOOLEAN NOT NULL DEFAULT false,
    "last_active_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "drivers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trips" (
    "id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "trip_uuid" VARCHAR(100) NOT NULL,
    "region" "Region" NOT NULL,
    "vehicle_type" VARCHAR(50),
    "requested_at" TIMESTAMPTZ NOT NULL,
    "duration_seconds" INTEGER,
    "distance_meters" INTEGER,
    "pickup_district" VARCHAR(100),
    "dropoff_district" VARCHAR(100),
    "currency" VARCHAR(10) NOT NULL,
    "fare_amount" DECIMAL(12,2) NOT NULL,
    "service_fee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "booking_fee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "tolls" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "tips" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "net_earnings" DECIMAL(12,2) NOT NULL,
    "is_pool_type" BOOLEAN NOT NULL DEFAULT false,
    "is_surge" BOOLEAN NOT NULL DEFAULT false,
    "uber_points" INTEGER,
    "payload_hash" VARCHAR(64) NOT NULL,
    "raw_payload" JSONB,
    "raw_payload_purge_at" TIMESTAMPTZ,
    "points_awarded" INTEGER NOT NULL DEFAULT 0,
    "processed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "review_status" "TripReviewStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "reviewed_by" VARCHAR(100),
    "reviewed_at" TIMESTAMPTZ,
    "review_note" VARCHAR(500),
    "flag_reason" VARCHAR(500),

    CONSTRAINT "trips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_syncs" (
    "id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "region" "Region" NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "trip_count" INTEGER NOT NULL,
    "source" VARCHAR(30) NOT NULL,
    "synced_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_syncs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "point_ledger" (
    "id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "trip_id" UUID,
    "amount" INTEGER NOT NULL,
    "balance" INTEGER NOT NULL,
    "type" VARCHAR(30) NOT NULL,
    "description" VARCHAR(500),
    "expires_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "point_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gift_cards" (
    "id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "provider" VARCHAR(100) NOT NULL,
    "region" "Region" NOT NULL,
    "points_cost" INTEGER NOT NULL,
    "face_value" DECIMAL(10,2) NOT NULL,
    "currency" VARCHAR(10) NOT NULL,
    "image_url" VARCHAR(500),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "stock_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "gift_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "redemptions" (
    "id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "gift_card_id" UUID NOT NULL,
    "points_spent" INTEGER NOT NULL,
    "status" "RedemptionStatus" NOT NULL DEFAULT 'PENDING',
    "fulfillment_ref" VARCHAR(200),
    "gift_card_code" VARCHAR(500),
    "failure_reason" VARCHAR(500),
    "confirmed_at" TIMESTAMPTZ,
    "fulfilled_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "user_agent" VARCHAR(500),
    "ip_address" VARCHAR(45),
    "expires_at" TIMESTAMPTZ NOT NULL,
    "revoked_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consents" (
    "id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "type" "ConsentType" NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "ip_address" VARCHAR(45),
    "user_agent" VARCHAR(500),
    "granted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ,

    CONSTRAINT "consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admins" (
    "id" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "role" "AdminRole" NOT NULL DEFAULT 'REVIEWER',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "admins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "uber_sessions" (
    "id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "source" VARCHAR(30) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_heartbeat" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "session_started" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "session_ended" TIMESTAMPTZ,
    "user_agent" VARCHAR(500),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "uber_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "driver_id" UUID,
    "admin_id" VARCHAR(100),
    "action" VARCHAR(100) NOT NULL,
    "resource" VARCHAR(100) NOT NULL,
    "resource_id" VARCHAR(100),
    "details" JSONB,
    "ip_address" VARCHAR(45),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "drivers_email_key" ON "drivers"("email");

-- CreateIndex
CREATE UNIQUE INDEX "drivers_referral_code_key" ON "drivers"("referral_code");

-- CreateIndex
CREATE INDEX "idx_driver_email" ON "drivers"("email");

-- CreateIndex
CREATE INDEX "idx_driver_region_status" ON "drivers"("region", "status");

-- CreateIndex
CREATE INDEX "idx_driver_referral_code" ON "drivers"("referral_code");

-- CreateIndex
CREATE INDEX "idx_driver_created_at" ON "drivers"("created_at");

-- CreateIndex
CREATE INDEX "idx_trip_driver_date" ON "trips"("driver_id", "requested_at" DESC);

-- CreateIndex
CREATE INDEX "idx_trip_region_date" ON "trips"("region", "requested_at" DESC);

-- CreateIndex
CREATE INDEX "idx_trip_processed" ON "trips"("processed_at");

-- CreateIndex
CREATE INDEX "idx_trip_purge" ON "trips"("raw_payload_purge_at");

-- CreateIndex
CREATE INDEX "idx_trip_review_status" ON "trips"("review_status", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "uq_driver_trip" ON "trips"("driver_id", "trip_uuid");

-- CreateIndex
CREATE INDEX "idx_activity_sync_driver" ON "activity_syncs"("driver_id", "synced_at" DESC);

-- CreateIndex
CREATE INDEX "idx_ledger_driver_date" ON "point_ledger"("driver_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_ledger_type_date" ON "point_ledger"("type", "created_at");

-- CreateIndex
CREATE INDEX "idx_ledger_expiry" ON "point_ledger"("expires_at");

-- CreateIndex
CREATE INDEX "idx_gift_card_region_active" ON "gift_cards"("region", "is_active");

-- CreateIndex
CREATE INDEX "idx_gift_card_cost" ON "gift_cards"("points_cost");

-- CreateIndex
CREATE INDEX "idx_redemption_driver_date" ON "redemptions"("driver_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_redemption_status" ON "redemptions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "idx_refresh_token_driver" ON "refresh_tokens"("driver_id");

-- CreateIndex
CREATE INDEX "idx_refresh_token_expiry" ON "refresh_tokens"("expires_at");

-- CreateIndex
CREATE INDEX "idx_consent_driver_type" ON "consents"("driver_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "admins_email_key" ON "admins"("email");

-- CreateIndex
CREATE INDEX "idx_uber_session_driver_active" ON "uber_sessions"("driver_id", "is_active");

-- CreateIndex
CREATE INDEX "idx_uber_session_heartbeat" ON "uber_sessions"("last_heartbeat");

-- CreateIndex
CREATE INDEX "idx_audit_driver_date" ON "audit_logs"("driver_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_audit_action_date" ON "audit_logs"("action", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_audit_resource" ON "audit_logs"("resource", "resource_id");

-- AddForeignKey
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_referred_by_fkey" FOREIGN KEY ("referred_by") REFERENCES "drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_syncs" ADD CONSTRAINT "activity_syncs_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "point_ledger" ADD CONSTRAINT "point_ledger_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "point_ledger" ADD CONSTRAINT "point_ledger_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "redemptions" ADD CONSTRAINT "redemptions_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "redemptions" ADD CONSTRAINT "redemptions_gift_card_id_fkey" FOREIGN KEY ("gift_card_id") REFERENCES "gift_cards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consents" ADD CONSTRAINT "consents_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uber_sessions" ADD CONSTRAINT "uber_sessions_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
