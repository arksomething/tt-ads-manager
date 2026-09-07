-- Bind each canonical raw-manifest row to the exact local producer run ID
-- embedded in its immutable aggregate JSON bytes. Canonical run_id remains a
-- UUIDv7 FK; producer_run_id is deliberately separate and byte-comparable.

ALTER TABLE creator_tracker_v2.raw_object_manifest_sets
  ADD COLUMN IF NOT EXISTS producer_run_id text;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM creator_tracker_v2.raw_object_manifest_sets
    WHERE producer_run_id IS NULL
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'producer run binding upgrade requires zero unbound raw manifest sets';
  END IF;
END
$$;

ALTER TABLE creator_tracker_v2.raw_object_manifest_sets
  ALTER COLUMN producer_run_id SET NOT NULL;

-- Reserve truthful adapter/request vocabulary now so provider continuity and
-- creator-authorized native APIs do not need a later destructive rewrite.
ALTER TABLE creator_tracker_v2.raw_object_manifest_sets
  DROP CONSTRAINT IF EXISTS raw_object_manifest_sets_purpose_check,
  DROP CONSTRAINT IF EXISTS raw_object_manifest_sets_purpose_ck;
ALTER TABLE creator_tracker_v2.raw_object_manifest_sets
  ADD CONSTRAINT raw_object_manifest_sets_purpose_ck CHECK (
    purpose IN (
      'account_discovery', 'video_observation', 'credit_rearm',
      'provider_reconciliation'
    )
  );

ALTER TABLE creator_tracker_v2.raw_object_manifest_entries
  DROP CONSTRAINT IF EXISTS raw_object_manifest_entries_adapter_check,
  DROP CONSTRAINT IF EXISTS raw_object_manifest_entries_adapter_ck,
  DROP CONSTRAINT IF EXISTS raw_object_manifest_entries_request_kind_check,
  DROP CONSTRAINT IF EXISTS raw_object_manifest_entries_request_kind_ck;
ALTER TABLE creator_tracker_v2.raw_object_manifest_entries
  ADD CONSTRAINT raw_object_manifest_entries_adapter_ck CHECK (
    adapter IN (
      'tiktok_ytdlp', 'scrapecreators_tiktok', 'scrapecreators_instagram',
      'viral_app_provider', 'tiktok_display_api', 'instagram_graph_api'
    )
  ),
  ADD CONSTRAINT raw_object_manifest_entries_request_kind_ck CHECK (
    request_kind IN (
      'profile_page', 'post_detail', 'profile_info', 'video_list',
      'video_query', 'provider_accounts_page', 'provider_videos_page'
    )
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conname = 'raw_object_manifest_sets_producer_run_id_ck'
      AND conrelid = 'creator_tracker_v2.raw_object_manifest_sets'::regclass
  ) THEN
    ALTER TABLE creator_tracker_v2.raw_object_manifest_sets
      ADD CONSTRAINT raw_object_manifest_sets_producer_run_id_ck CHECK (
        producer_run_id ~
          '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      );
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION creator_tracker_v2.validate_raw_manifest_set_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  manifest_row creator_tracker_v2.raw_object_manifests%ROWTYPE;
  run_row creator_tracker_v2.tracking_runs%ROWTYPE;
BEGIN
  SELECT * INTO manifest_row
  FROM creator_tracker_v2.raw_object_manifests
  WHERE organization_id = NEW.organization_id
    AND run_id = NEW.run_id
    AND id = NEW.raw_manifest_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23503',
      MESSAGE = 'raw manifest set must reference a tenant-matching aggregate manifest';
  END IF;

  SELECT * INTO run_row
  FROM creator_tracker_v2.tracking_runs
  WHERE organization_id = NEW.organization_id
    AND id = NEW.run_id;

  IF manifest_row.content_type <> 'application/json'
     OR manifest_row.byte_length <= 0
     OR NEW.producer_run_id !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR manifest_row.source NOT IN (
       'tiktok_ytdlp', 'scrapecreators_tiktok', 'scrapecreators_instagram',
       'viral_app_provider', 'tiktok_display_api', 'instagram_graph_api'
     )
     OR run_row.id IS NULL
     OR manifest_row.source <> run_row.adapter
     OR manifest_row.fetched_at < run_row.request_started_at
     OR manifest_row.fetched_at > run_row.completed_at
     OR manifest_row.source_observed_at IS NULL
     OR manifest_row.source_observed_at < run_row.request_started_at
     OR manifest_row.source_observed_at > manifest_row.fetched_at
     OR manifest_row.storage_key <> 'creator-tracker/raw/v1/sha256/'
       || left(manifest_row.sha256::text, 2) || '/' || manifest_row.sha256::text THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'aggregate manifest must bind canonical lineage to canonical content-addressed JSON';
  END IF;

  NEW.created_at := transaction_timestamp();
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION creator_tracker_v2.validate_raw_manifest_entry_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  set_row creator_tracker_v2.raw_object_manifest_sets%ROWTYPE;
  manifest_row creator_tracker_v2.raw_object_manifests%ROWTYPE;
  run_row creator_tracker_v2.tracking_runs%ROWTYPE;
  vocabulary_matches boolean;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('creator-tracker-v2-raw:' || NEW.raw_manifest_id::text, 0)
  );

  SELECT * INTO set_row
  FROM creator_tracker_v2.raw_object_manifest_sets
  WHERE organization_id = NEW.organization_id
    AND run_id = NEW.run_id
    AND raw_manifest_id = NEW.raw_manifest_id;

  SELECT * INTO manifest_row
  FROM creator_tracker_v2.raw_object_manifests
  WHERE organization_id = NEW.organization_id
    AND run_id = NEW.run_id
    AND id = NEW.raw_manifest_id;

  SELECT * INTO run_row
  FROM creator_tracker_v2.tracking_runs
  WHERE organization_id = NEW.organization_id
    AND id = NEW.run_id;

  IF set_row.raw_manifest_id IS NULL
     OR manifest_row.id IS NULL
     OR run_row.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23503',
      MESSAGE = 'raw manifest entry must reference its tenant-matching set and run';
  END IF;

  vocabulary_matches := CASE
    WHEN NEW.adapter = 'tiktok_ytdlp' THEN
      NEW.request_kind IN ('profile_page', 'post_detail')
    WHEN NEW.adapter IN ('scrapecreators_tiktok', 'scrapecreators_instagram') THEN
      NEW.request_kind IN ('profile_page', 'post_detail', 'profile_info', 'video_query')
    WHEN NEW.adapter IN ('tiktok_display_api', 'instagram_graph_api') THEN
      NEW.request_kind IN ('profile_info', 'video_list', 'video_query')
    WHEN NEW.adapter = 'viral_app_provider' THEN
      NEW.request_kind IN ('provider_accounts_page', 'provider_videos_page')
    ELSE false
  END;

  vocabulary_matches := vocabulary_matches AND CASE set_row.purpose
    WHEN 'provider_reconciliation' THEN
      NEW.adapter = 'viral_app_provider'
      AND NEW.request_kind IN ('provider_accounts_page', 'provider_videos_page')
    WHEN 'video_observation' THEN
      NEW.adapter <> 'viral_app_provider'
      AND NEW.request_kind IN ('post_detail', 'video_query')
    WHEN 'account_discovery' THEN
      NEW.adapter <> 'viral_app_provider'
      AND NEW.request_kind IN ('profile_page', 'profile_info', 'video_list')
    WHEN 'credit_rearm' THEN NEW.adapter <> 'viral_app_provider'
    ELSE false
  END;

  IF NEW.ordinal >= set_row.response_count
     OR NEW.adapter <> manifest_row.source
     OR NEW.adapter <> run_row.adapter
     OR NOT vocabulary_matches
     OR pg_catalog.to_timestamp(NEW.source_observed_at_ms::numeric / 1000)
       < run_row.request_started_at
     OR pg_catalog.to_timestamp(NEW.source_observed_at_ms::numeric / 1000)
       > run_row.completed_at
     OR pg_catalog.to_timestamp(NEW.source_observed_at_ms::numeric / 1000)
       > manifest_row.fetched_at THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'raw manifest entry does not truthfully match its adapter, purpose, aggregate, or run';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM creator_tracker_v2.raw_object_verifications verification
    WHERE verification.organization_id = NEW.organization_id
      AND verification.raw_manifest_id = NEW.raw_manifest_id
      AND verification.raw_manifest_entry_id IS NULL
      AND verification.verification_method = 'sha256_full_read_recursive_manifest_v1'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '55000',
      MESSAGE = 'a recursively verified aggregate cannot accept later child entries';
  END IF;

  NEW.created_at := transaction_timestamp();
  RETURN NEW;
END
$$;

-- Payable finalization is deliberately narrower than raw-byte verification.
-- Public/native creator-authorized sources may qualify as direct evidence;
-- Viral.app and ScrapeCreators remain provider continuity only.
CREATE OR REPLACE FUNCTION creator_tracker_v2.require_finalization_raw_verification()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  coverage_row creator_tracker_v2.source_coverage_windows%ROWTYPE;
BEGIN
  IF NEW.status IS DISTINCT FROM 'final' THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    WITH required_observation_ids AS (
      SELECT observation_id
      FROM unnest(ARRAY[
        NEW.baseline_observation_id::uuid,
        NEW.pre_cutoff_observation_id::uuid,
        NEW.post_cutoff_observation_id::uuid,
        NEW.selected_final_observation_id::uuid
      ]) AS required(observation_id)
      WHERE observation_id IS NOT NULL
    )
    SELECT 1
    FROM required_observation_ids required
    LEFT JOIN creator_tracker_v2.video_observations observation
      ON observation.organization_id = NEW.organization_id
     AND observation.video_id = NEW.video_id
     AND observation.id = required.observation_id
    WHERE observation.id IS NULL
       OR observation.confidence <> 'direct'
       OR observation.adapter NOT IN (
         'tiktok_ytdlp', 'tiktok_display_api', 'instagram_graph_api'
       )
       OR observation.raw_manifest_id IS NULL
       OR NOT COALESCE(
         creator_tracker_v2.raw_manifest_has_fresh_recursive_verification(
           observation.organization_id,
           observation.run_id,
           observation.raw_manifest_id,
           transaction_timestamp()
         ),
         false
       )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'finalization requires fresh recursively verified direct native evidence for every selected observation';
  END IF;

  SELECT * INTO coverage_row
  FROM creator_tracker_v2.source_coverage_windows
  WHERE organization_id = NEW.organization_id
    AND id = NEW.coverage_id;

  IF NOT FOUND OR NOT EXISTS (
    SELECT 1
    FROM creator_tracker_v2.raw_object_manifests manifest
    WHERE manifest.organization_id = coverage_row.organization_id
      AND manifest.run_id = coverage_row.run_id
      AND manifest.sha256 = coverage_row.evidence_sha256
      AND manifest.source IN (
        'tiktok_ytdlp', 'tiktok_display_api', 'instagram_graph_api'
      )
      AND creator_tracker_v2.raw_manifest_has_fresh_recursive_verification(
        manifest.organization_id,
        manifest.run_id,
        manifest.id,
        transaction_timestamp()
      )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'finalization requires fresh recursively verified direct native coverage';
  END IF;

  RETURN NEW;
END
$$;

REVOKE ALL PRIVILEGES ON FUNCTION
  creator_tracker_v2.validate_raw_manifest_set_insert() FROM PUBLIC;
REVOKE ALL PRIVILEGES ON FUNCTION
  creator_tracker_v2.validate_raw_manifest_entry_insert() FROM PUBLIC;
REVOKE ALL PRIVILEGES ON FUNCTION
  creator_tracker_v2.require_finalization_raw_verification() FROM PUBLIC;

COMMENT ON COLUMN creator_tracker_v2.raw_object_manifest_sets.producer_run_id IS
  'Canonical lowercase UUIDv4 embedded as runId in the exact aggregate manifest bytes; distinct from canonical UUIDv7 run_id.';
