-- ============================================================
-- 0004 — import_jobs: audit trail for AI-powered imports
--
-- Stores complete provenance of every AI-assisted import:
-- original file reference, LLM extraction output, user edits,
-- final committed holdings. Answers "why does my portfolio
-- show this?" after an import. User-scoped RLS.
--
-- Additive only: new table, no changes to existing objects.
-- ============================================================

create table if not exists public.import_jobs (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,

  -- provenance
  filename      text not null,             -- original uploaded file name
  file_type     text not null,             -- 'cas_pdf' | 'broker_pdf' | 'spreadsheet' | 'image'
  asset_type    text,                      -- 'equity' | 'mf' | 'crypto' | 'fd' | 'gold' | 'other'
  input_format  text,                      -- detected format detail (e.g., 'CAMS', 'KFintech', 'Zerodha')
  uploaded_at   timestamptz not null default now(),

  -- extraction
  extracted_data      jsonb,               -- raw LLM output (structured schema)
  extraction_model    text,                -- model used (e.g., 'claude-3-5-sonnet-20241022')
  extraction_tokens   int,                 -- token count for cost tracking
  extraction_errors   jsonb,               -- per-chunk errors if any

  -- matching
  matched_holdings    jsonb,               -- matched against mf_master/equity_master with confidence
  low_confidence_ids  text[],              -- IDs flagged for review

  -- user review
  reviewed_at         timestamptz,         -- when user confirmed/edited
  user_edits          jsonb,               -- changes made in review screen

  -- commit
  committed_at        timestamptz,         -- when holdings were written
  committed_asset_ids uuid[],              -- foreign keys to assets table

  status        text not null default 'pending',  -- 'pending' | 'reviewed' | 'committed' | 'failed'
  notes         text,                      -- user notes or system failure reason

  updated_at    timestamptz not null default now()
);

comment on table public.import_jobs is
  'Audit trail for AI-powered imports — tracks extraction, matching, user edits, and final committed holdings.';

-- RLS: users see only their own import jobs
alter table public.import_jobs enable row level security;

create policy "import_jobs_user_scoped" on public.import_jobs
  for all using (auth.uid() = user_id);

create trigger import_jobs_touch before update on public.import_jobs
  for each row execute function public.touch_updated_at();

-- Index for listing user's recent imports
create index if not exists import_jobs_user_uploaded on public.import_jobs (user_id, uploaded_at desc);
