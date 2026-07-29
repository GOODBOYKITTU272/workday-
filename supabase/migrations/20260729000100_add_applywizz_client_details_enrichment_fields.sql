alter table public.candidates
  add column if not exists applywizz_client_id text,
  add column if not exists external_resume_url text,
  add column if not exists external_resume_source text;

create unique index if not exists candidates_applywizz_client_id_idx
  on public.candidates (applywizz_client_id)
  where applywizz_client_id is not null;
