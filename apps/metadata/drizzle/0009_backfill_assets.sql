-- Every uploaded original a job has read becomes an asset, owned by the user of its first job.
-- The upload size was never recorded, so it stays null. Comparisons go through ::text because
-- on a fresh database all migrations share one transaction with the enum values they use.
INSERT INTO "assets" ("user_id", "key", "kind", "content_type", "created_at", "attached_at")
SELECT DISTINCT ON (j."input"->>'sourceKey')
  j."user_id",
  j."input"->>'sourceKey',
  (CASE WHEN e."ext" IN ('mp4', 'webm', 'mov') THEN 'video' ELSE 'image' END)::"asset_kind",
  CASE e."ext"
    WHEN 'jpg' THEN 'image/jpeg'
    WHEN 'png' THEN 'image/png'
    WHEN 'webp' THEN 'image/webp'
    WHEN 'mp4' THEN 'video/mp4'
    WHEN 'webm' THEN 'video/webm'
    WHEN 'mov' THEN 'video/quicktime'
  END,
  j."created_at",
  j."created_at"
FROM "jobs" j
CROSS JOIN LATERAL (
  SELECT lower(substring(j."input"->>'sourceKey' FROM '\.([^./]+)$')) AS "ext"
) e
WHERE j."input"->>'sourceKey' IS NOT NULL
  AND e."ext" IN ('jpg', 'png', 'webp', 'mp4', 'webm', 'mov')
ORDER BY j."input"->>'sourceKey', j."created_at"
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
UPDATE "jobs" j
SET "asset_id" = a."id"
FROM "assets" a
WHERE a."key" = j."input"->>'sourceKey' AND a."user_id" = j."user_id";--> statement-breakpoint
-- Video jobs report the size and duration of the original; image jobs did not before 5c.2.
UPDATE "assets" a
SET
  "width" = (v."output"->>'width')::integer,
  "height" = (v."output"->>'height')::integer,
  "duration_seconds" = (v."output"->>'durationSeconds')::double precision
FROM (
  SELECT DISTINCT ON ("asset_id") "asset_id", "output"
  FROM "jobs"
  WHERE "asset_id" IS NOT NULL
    AND "status"::text = 'succeeded'
    AND "type"::text IN ('video.frames', 'video.transcode')
    AND "output" ? 'durationSeconds'
  ORDER BY "asset_id", "finished_at" DESC
) v
WHERE a."id" = v."asset_id";
