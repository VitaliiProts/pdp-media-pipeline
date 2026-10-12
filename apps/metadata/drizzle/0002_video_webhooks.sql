CREATE TYPE "public"."webhook_event" AS ENUM('job.succeeded', 'job.dead');--> statement-breakpoint
ALTER TYPE "public"."job_type" ADD VALUE 'webhook.deliver';--> statement-breakpoint
CREATE TABLE "webhook_endpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"url" text NOT NULL,
	"secret" text NOT NULL,
	"events" "webhook_event"[] NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "webhook_endpoints_user_idx" ON "webhook_endpoints" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "jobs_webhook_endpoint_idx" ON "jobs" USING btree (("input"->>'endpointId'),"created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE ("jobs"."input"->>'endpointId') is not null;