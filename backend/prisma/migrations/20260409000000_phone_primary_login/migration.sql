-- Make phone required and unique (primary login identifier)
-- Make email optional (was previously unique + required)

-- Step 1: For any existing drivers without phone, set a placeholder
UPDATE "drivers" SET "phone" = CONCAT('+000', "id") WHERE "phone" IS NULL OR "phone" = '';

-- Step 2: Drop old email unique index if it exists
DROP INDEX IF EXISTS "drivers_email_key";

-- Step 3: Make phone NOT NULL and add unique constraint
ALTER TABLE "drivers" ALTER COLUMN "phone" SET NOT NULL;
CREATE UNIQUE INDEX "drivers_phone_key" ON "drivers"("phone");

-- Step 4: Make email optional (allow NULL)
ALTER TABLE "drivers" ALTER COLUMN "email" DROP NOT NULL;

-- Step 5: Replace email index with phone index
DROP INDEX IF EXISTS "idx_driver_email";
CREATE INDEX "idx_driver_phone" ON "drivers"("phone");

-- Step 6: Add reset token columns if they don't exist
ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "reset_token_hash" VARCHAR(64);
ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "reset_token_expires_at" TIMESTAMPTZ;

-- Step 7: Add uber credential region index if it doesn't exist
CREATE INDEX IF NOT EXISTS "idx_uber_cred_region_valid" ON "uber_credentials"("region", "is_valid");
