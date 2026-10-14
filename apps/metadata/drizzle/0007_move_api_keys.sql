-- Existing keys keep working: each becomes the user's first entry in api_keys.
INSERT INTO "api_keys" ("user_id", "name", "hash", "prefix", "created_at")
SELECT "id", 'default', "api_key_hash", "api_key_prefix", "created_at" FROM "users";--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_api_key_hash_unique";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "api_key_hash";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "api_key_prefix";
