CREATE TYPE "public"."asset_kind" AS ENUM('image', 'video');--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"key" text NOT NULL,
	"kind" "asset_kind" NOT NULL,
	"name" text,
	"content_type" text NOT NULL,
	"size" bigint,
	"width" integer,
	"height" integer,
	"duration_seconds" double precision,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"attached_at" timestamp (3) with time zone,
	"deleted_at" timestamp (3) with time zone,
	CONSTRAINT "assets_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "asset_id" uuid;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assets_user_created_idx" ON "assets" USING btree ("user_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "assets"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "assets_user_kind_created_idx" ON "assets" USING btree ("user_id","kind","created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "assets"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "assets_unattached_idx" ON "assets" USING btree ("created_at") WHERE "assets"."attached_at" is null and "assets"."deleted_at" is null;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "jobs_asset_created_idx" ON "jobs" USING btree ("asset_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "jobs"."asset_id" is not null;