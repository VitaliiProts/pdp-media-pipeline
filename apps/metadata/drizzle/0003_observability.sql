ALTER TABLE "jobs" ADD COLUMN "trace_id" text;--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "trace_context" jsonb;