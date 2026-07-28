alter table public.candidates
  add column if not exists external_source text,
  add column if not exists external_lead_id text,
  add column if not exists plan text,
  add column if not exists start_date date,
  add column if not exists assigned_associate_name text,
  add column if not exists assigned_associate_email text,
  add column if not exists last_synced_at timestamptz;

create unique index if not exists candidates_external_source_external_lead_id_idx
  on public.candidates (external_source, external_lead_id);
