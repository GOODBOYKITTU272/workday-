create extension if not exists pgcrypto;

create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text not null unique,
  role text not null check (role in ('admin', 'operator', 'viewer')),
  status text not null default 'active' check (status in ('active', 'inactive', 'suspended')),
  avatar_url text,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.users where id = auth.uid() and status = 'active'
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_user_role() = 'admin', false)
$$;

create or replace function public.can_operate()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_user_role() in ('admin', 'operator'), false)
$$;

create or replace function public.can_view()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_user_role() in ('admin', 'operator', 'viewer'), false)
$$;

create or replace function public.prevent_user_privilege_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_admin() or coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;

  if old.id is distinct from new.id
    or old.email is distinct from new.email
    or old.role is distinct from new.role
    or old.status is distinct from new.status
    or old.last_login_at is distinct from new.last_login_at
    or old.created_at is distinct from new.created_at then
    raise exception 'only admin can update protected user fields';
  end if;

  return new;
end;
$$;

create or replace function public.prevent_non_admin_run_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.status = 'approved_for_submit'
      or new.approved_by is not null
      or new.approved_at is not null then
      raise exception 'only admin can approve final submit';
    end if;

    return new;
  end if;

  if new.status = 'approved_for_submit' and old.status is distinct from new.status then
    raise exception 'only admin can approve final submit';
  end if;

  if new.approved_by is distinct from old.approved_by
    or new.approved_at is distinct from old.approved_at then
    raise exception 'only admin can change final submit approval fields';
  end if;

  return new;
end;
$$;

create or replace function public.prevent_non_admin_question_bank_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.is_global
      and (new.approved_by is not null or new.approved_at is not null) then
      raise exception 'only admin can approve global question bank entries';
    end if;

    return new;
  end if;

  if new.is_global
    and (new.approved_by is distinct from old.approved_by
      or new.approved_at is distinct from old.approved_at) then
    raise exception 'only admin can approve global question bank entries';
  end if;

  return new;
end;
$$;

create table public.candidates (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references public.users(id),
  full_name text not null,
  email text not null,
  phone text,
  location text,
  target_role text,
  years_experience numeric,
  linkedin_url text,
  github_url text,
  portfolio_url text,
  current_company text,
  expected_salary text,
  availability text,
  relocation_preference text,
  sponsorship_requirement text,
  work_authorization text,
  status text not null default 'active' check (status in ('active', 'inactive', 'archived')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.candidate_resumes (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  storage_bucket text not null default 'candidate-resumes',
  storage_path text not null,
  file_name text not null,
  file_type text not null check (file_type in ('pdf', 'doc', 'docx')),
  file_size_bytes bigint,
  is_active boolean not null default true,
  uploaded_by uuid references public.users(id),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.candidate_answers (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  question_key text not null,
  question_text text,
  normalized_question text,
  answer_value text not null,
  answer_json jsonb,
  answer_type text not null default 'text' check (answer_type in ('text', 'number', 'boolean', 'single_select', 'multi_select', 'date', 'file', 'json')),
  risk_level text not null default 'unknown' check (risk_level in ('low', 'medium', 'high', 'unknown')),
  category text,
  is_approved boolean not null default false,
  approved_by uuid references public.users(id),
  approved_at timestamptz,
  source text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (candidate_id, question_key)
);

create table public.question_bank (
  id uuid primary key default gen_random_uuid(),
  question_key text not null unique,
  canonical_question text not null,
  normalized_question text not null,
  question_variants jsonb,
  answer_type text not null default 'text' check (answer_type in ('text', 'number', 'boolean', 'single_select', 'multi_select', 'date', 'file', 'json')),
  default_answer_value text,
  default_answer_json jsonb,
  risk_level text not null default 'unknown' check (risk_level in ('low', 'medium', 'high', 'unknown')),
  category text,
  is_global boolean not null default true,
  is_active boolean not null default true,
  requires_manual_review boolean not null default true,
  usage_count integer not null default 0,
  success_count integer not null default 0,
  last_used_at timestamptz,
  created_by uuid references public.users(id),
  approved_by uuid references public.users(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.zoho_mailboxes (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  email text not null,
  zoho_account_id text,
  access_token_encrypted text,
  refresh_token_encrypted text,
  token_expires_at timestamptz,
  connection_status text not null default 'not_connected' check (connection_status in ('not_connected', 'connected', 'expired', 'failed', 'revoked')),
  last_otp_check_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workday_accounts (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  tenant_key text not null,
  tenant_name text,
  workday_base_url text,
  email text not null,
  username text,
  password_encrypted text,
  account_status text not null default 'unknown' check (account_status in ('unknown', 'created', 'existing', 'login_success', 'login_failed', 'otp_required', 'locked', 'disabled')),
  last_login_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (candidate_id, tenant_key)
);

create table public.job_links (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  created_by uuid references public.users(id),
  url text not null,
  normalized_url text not null,
  company_name text,
  job_title text,
  workday_tenant_key text,
  source text,
  status text not null default 'queued' check (status in ('queued', 'running', 'opened', 'login_required', 'otp_required', 'logged_in', 'resume_uploaded', 'questionnaire_reached', 'questions_extracted', 'answers_mapped', 'manual_review_required', 'dry_run_complete', 'approved_for_submit', 'submitted', 'failed', 'duplicate', 'skipped')),
  last_run_id uuid,
  last_error text,
  priority integer not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (candidate_id, normalized_url)
);

create table public.application_runs (
  id uuid primary key default gen_random_uuid(),
  job_link_id uuid not null references public.job_links(id) on delete cascade,
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  started_by uuid references public.users(id),
  status text not null default 'queued' check (status in ('queued', 'starting', 'opening_job_link', 'detecting_page_state', 'login_or_create_account', 'waiting_for_otp', 'otp_verified', 'uploading_resume', 'resume_uploaded', 'reaching_questionnaire', 'capturing_html', 'extracting_questions', 'mapping_answers', 'filling_safe_answers', 'checking_conditional_questions', 'manual_review_required', 'dry_run_complete', 'human_approval_required', 'approved_for_submit', 'submitting', 'submitted', 'stopped', 'failed')),
  mode text not null default 'dry_run' check (mode in ('dry_run', 'controlled_submit')),
  current_step text,
  readiness_score text check (readiness_score in ('ready', 'needs_review', 'blocked', 'failed')),
  total_questions_found integer not null default 0,
  total_answers_mapped integer not null default 0,
  total_answers_filled integer not null default 0,
  total_manual_review_items integer not null default 0,
  total_high_risk_items integer not null default 0,
  error_code text,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  approved_by uuid references public.users(id),
  approved_at timestamptz,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.job_links
  add constraint job_links_last_run_id_fkey
  foreign key (last_run_id) references public.application_runs(id) on delete set null;

create table public.run_steps (
  id uuid primary key default gen_random_uuid(),
  application_run_id uuid not null references public.application_runs(id) on delete cascade,
  step_name text not null,
  step_status text not null default 'started' check (step_status in ('started', 'success', 'failed', 'skipped', 'waiting', 'retrying')),
  step_order integer not null,
  message text,
  current_url text,
  duration_ms integer,
  error_code text,
  error_message text,
  metadata jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.screenshots (
  id uuid primary key default gen_random_uuid(),
  application_run_id uuid not null references public.application_runs(id) on delete cascade,
  run_step_id uuid references public.run_steps(id) on delete set null,
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  job_link_id uuid not null references public.job_links(id) on delete cascade,
  storage_bucket text not null default 'run-screenshots',
  storage_path text not null,
  step_name text,
  page_url text,
  caption text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.extracted_questions (
  id uuid primary key default gen_random_uuid(),
  application_run_id uuid not null references public.application_runs(id) on delete cascade,
  job_link_id uuid not null references public.job_links(id) on delete cascade,
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  question_text text not null,
  normalized_question text not null,
  section_name text,
  field_type text not null check (field_type in ('text', 'number', 'email', 'phone', 'date', 'dropdown', 'radio', 'checkbox', 'multi_select', 'yes_no', 'file_upload', 'address', 'legal_acknowledgment', 'unknown')),
  field_name text,
  field_id text,
  field_selector text,
  options jsonb,
  is_required boolean not null default false,
  is_visible boolean not null default true,
  page_step text,
  risk_level text not null default 'unknown' check (risk_level in ('low', 'medium', 'high', 'unknown')),
  extraction_confidence numeric,
  source_html_storage_path text,
  screenshot_id uuid references public.screenshots(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.mapped_answers (
  id uuid primary key default gen_random_uuid(),
  application_run_id uuid not null references public.application_runs(id) on delete cascade,
  extracted_question_id uuid not null references public.extracted_questions(id) on delete cascade,
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  source_type text not null check (source_type in ('candidate_answer', 'question_bank', 'profile_field', 'manual_review', 'ai_suggested', 'none')),
  source_id uuid,
  suggested_answer text,
  suggested_answer_json jsonb,
  final_answer text,
  final_answer_json jsonb,
  confidence_score numeric,
  risk_level text not null default 'unknown' check (risk_level in ('low', 'medium', 'high', 'unknown')),
  mapping_status text not null default 'pending' check (mapping_status in ('pending', 'mapped', 'needs_review', 'approved', 'rejected', 'filled', 'skipped')),
  requires_manual_review boolean not null default true,
  ai_reasoning_summary text,
  approved_by uuid references public.users(id),
  approved_at timestamptz,
  filled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.manual_review_items (
  id uuid primary key default gen_random_uuid(),
  application_run_id uuid not null references public.application_runs(id) on delete cascade,
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  job_link_id uuid not null references public.job_links(id) on delete cascade,
  extracted_question_id uuid not null references public.extracted_questions(id) on delete cascade,
  mapped_answer_id uuid references public.mapped_answers(id) on delete set null,
  review_reason text not null,
  risk_level text not null default 'unknown' check (risk_level in ('low', 'medium', 'high', 'unknown')),
  question_text text not null,
  field_type text,
  options jsonb,
  suggested_answer text,
  final_answer text,
  status text not null default 'open' check (status in ('open', 'approved', 'edited', 'rejected', 'marked_unsafe', 'skipped', 'resolved')),
  assigned_to uuid references public.users(id),
  resolved_by uuid references public.users(id),
  resolved_at timestamptz,
  save_to_answer_bank boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.otp_logs (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  application_run_id uuid references public.application_runs(id) on delete cascade,
  zoho_mailbox_id uuid references public.zoho_mailboxes(id) on delete set null,
  provider text not null default 'zoho',
  email_subject text,
  sender_email text,
  otp_code_masked text,
  otp_found boolean not null default false,
  used_successfully boolean not null default false,
  error_message text,
  checked_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.automation_logs (
  id uuid primary key default gen_random_uuid(),
  application_run_id uuid references public.application_runs(id) on delete cascade,
  run_step_id uuid references public.run_steps(id) on delete set null,
  level text not null check (level in ('debug', 'info', 'warn', 'error')),
  message text not null,
  context jsonb,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.system_settings (
  id uuid primary key default gen_random_uuid(),
  setting_key text not null unique,
  setting_value jsonb not null,
  description text,
  is_sensitive boolean not null default false,
  updated_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references public.users(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  candidate_id uuid references public.candidates(id) on delete set null,
  application_run_id uuid references public.application_runs(id) on delete set null,
  metadata jsonb,
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index users_email_idx on public.users(email);
create index users_role_idx on public.users(role);
create index users_status_idx on public.users(status);
create index candidates_email_idx on public.candidates(email);
create index candidates_status_idx on public.candidates(status);
create index candidates_created_by_idx on public.candidates(created_by);
create index candidates_target_role_idx on public.candidates(target_role);
create index candidate_resumes_candidate_id_idx on public.candidate_resumes(candidate_id);
create index candidate_resumes_is_active_idx on public.candidate_resumes(is_active);
create unique index candidate_resumes_one_active_idx on public.candidate_resumes(candidate_id) where is_active = true;
create index candidate_answers_candidate_id_idx on public.candidate_answers(candidate_id);
create index candidate_answers_question_key_idx on public.candidate_answers(question_key);
create index candidate_answers_normalized_question_idx on public.candidate_answers(normalized_question);
create index candidate_answers_risk_level_idx on public.candidate_answers(risk_level);
create index candidate_answers_is_approved_idx on public.candidate_answers(is_approved);
create index question_bank_question_key_idx on public.question_bank(question_key);
create index question_bank_normalized_question_idx on public.question_bank(normalized_question);
create index question_bank_risk_level_idx on public.question_bank(risk_level);
create index question_bank_category_idx on public.question_bank(category);
create index question_bank_is_active_idx on public.question_bank(is_active);
create index zoho_mailboxes_candidate_id_idx on public.zoho_mailboxes(candidate_id);
create index zoho_mailboxes_email_idx on public.zoho_mailboxes(email);
create index zoho_mailboxes_status_idx on public.zoho_mailboxes(connection_status);
create index workday_accounts_candidate_id_idx on public.workday_accounts(candidate_id);
create index workday_accounts_tenant_key_idx on public.workday_accounts(tenant_key);
create index workday_accounts_candidate_tenant_idx on public.workday_accounts(candidate_id, tenant_key);
create index workday_accounts_status_idx on public.workday_accounts(account_status);
create index job_links_candidate_id_idx on public.job_links(candidate_id);
create index job_links_status_idx on public.job_links(status);
create index job_links_normalized_url_idx on public.job_links(normalized_url);
create index job_links_workday_tenant_key_idx on public.job_links(workday_tenant_key);
create index job_links_created_at_idx on public.job_links(created_at);
create index job_links_priority_idx on public.job_links(priority);
create index application_runs_job_link_id_idx on public.application_runs(job_link_id);
create index application_runs_candidate_id_idx on public.application_runs(candidate_id);
create index application_runs_status_idx on public.application_runs(status);
create index application_runs_started_by_idx on public.application_runs(started_by);
create index application_runs_created_at_idx on public.application_runs(created_at);
create index application_runs_readiness_score_idx on public.application_runs(readiness_score);
create index run_steps_application_run_id_idx on public.run_steps(application_run_id);
create index run_steps_step_name_idx on public.run_steps(step_name);
create index run_steps_step_status_idx on public.run_steps(step_status);
create index run_steps_order_idx on public.run_steps(application_run_id, step_order);
create index screenshots_application_run_id_idx on public.screenshots(application_run_id);
create index screenshots_run_step_id_idx on public.screenshots(run_step_id);
create index screenshots_candidate_id_idx on public.screenshots(candidate_id);
create index screenshots_job_link_id_idx on public.screenshots(job_link_id);
create index screenshots_created_at_idx on public.screenshots(created_at);
create index extracted_questions_application_run_id_idx on public.extracted_questions(application_run_id);
create index extracted_questions_job_link_id_idx on public.extracted_questions(job_link_id);
create index extracted_questions_candidate_id_idx on public.extracted_questions(candidate_id);
create index extracted_questions_normalized_question_idx on public.extracted_questions(normalized_question);
create index extracted_questions_risk_level_idx on public.extracted_questions(risk_level);
create index extracted_questions_field_type_idx on public.extracted_questions(field_type);
create index mapped_answers_application_run_id_idx on public.mapped_answers(application_run_id);
create index mapped_answers_extracted_question_id_idx on public.mapped_answers(extracted_question_id);
create index mapped_answers_candidate_id_idx on public.mapped_answers(candidate_id);
create index mapped_answers_mapping_status_idx on public.mapped_answers(mapping_status);
create index mapped_answers_risk_level_idx on public.mapped_answers(risk_level);
create index mapped_answers_requires_manual_review_idx on public.mapped_answers(requires_manual_review);
create index manual_review_items_application_run_id_idx on public.manual_review_items(application_run_id);
create index manual_review_items_candidate_id_idx on public.manual_review_items(candidate_id);
create index manual_review_items_job_link_id_idx on public.manual_review_items(job_link_id);
create index manual_review_items_status_idx on public.manual_review_items(status);
create index manual_review_items_risk_level_idx on public.manual_review_items(risk_level);
create index manual_review_items_assigned_to_idx on public.manual_review_items(assigned_to);
create index otp_logs_candidate_id_idx on public.otp_logs(candidate_id);
create index otp_logs_application_run_id_idx on public.otp_logs(application_run_id);
create index otp_logs_zoho_mailbox_id_idx on public.otp_logs(zoho_mailbox_id);
create index otp_logs_checked_at_idx on public.otp_logs(checked_at);
create index otp_logs_otp_found_idx on public.otp_logs(otp_found);
create index automation_logs_application_run_id_idx on public.automation_logs(application_run_id);
create index automation_logs_run_step_id_idx on public.automation_logs(run_step_id);
create index automation_logs_level_idx on public.automation_logs(level);
create index automation_logs_created_at_idx on public.automation_logs(created_at);
create index system_settings_setting_key_idx on public.system_settings(setting_key);
create index audit_logs_actor_user_id_idx on public.audit_logs(actor_user_id);
create index audit_logs_action_idx on public.audit_logs(action);
create index audit_logs_entity_type_idx on public.audit_logs(entity_type);
create index audit_logs_candidate_id_idx on public.audit_logs(candidate_id);
create index audit_logs_application_run_id_idx on public.audit_logs(application_run_id);
create index audit_logs_created_at_idx on public.audit_logs(created_at);

create trigger users_set_updated_at before update on public.users for each row execute function public.set_updated_at();
create trigger users_prevent_privilege_escalation before update on public.users for each row execute function public.prevent_user_privilege_escalation();
create trigger candidates_set_updated_at before update on public.candidates for each row execute function public.set_updated_at();
create trigger candidate_resumes_set_updated_at before update on public.candidate_resumes for each row execute function public.set_updated_at();
create trigger candidate_answers_set_updated_at before update on public.candidate_answers for each row execute function public.set_updated_at();
create trigger question_bank_set_updated_at before update on public.question_bank for each row execute function public.set_updated_at();
create trigger question_bank_prevent_non_admin_approval before insert or update on public.question_bank for each row execute function public.prevent_non_admin_question_bank_approval();
create trigger zoho_mailboxes_set_updated_at before update on public.zoho_mailboxes for each row execute function public.set_updated_at();
create trigger workday_accounts_set_updated_at before update on public.workday_accounts for each row execute function public.set_updated_at();
create trigger job_links_set_updated_at before update on public.job_links for each row execute function public.set_updated_at();
create trigger application_runs_set_updated_at before update on public.application_runs for each row execute function public.set_updated_at();
create trigger application_runs_prevent_non_admin_approval before insert or update on public.application_runs for each row execute function public.prevent_non_admin_run_approval();
create trigger run_steps_set_updated_at before update on public.run_steps for each row execute function public.set_updated_at();
create trigger screenshots_set_updated_at before update on public.screenshots for each row execute function public.set_updated_at();
create trigger extracted_questions_set_updated_at before update on public.extracted_questions for each row execute function public.set_updated_at();
create trigger mapped_answers_set_updated_at before update on public.mapped_answers for each row execute function public.set_updated_at();
create trigger manual_review_items_set_updated_at before update on public.manual_review_items for each row execute function public.set_updated_at();
create trigger otp_logs_set_updated_at before update on public.otp_logs for each row execute function public.set_updated_at();
create trigger automation_logs_set_updated_at before update on public.automation_logs for each row execute function public.set_updated_at();
create trigger system_settings_set_updated_at before update on public.system_settings for each row execute function public.set_updated_at();
create trigger audit_logs_set_updated_at before update on public.audit_logs for each row execute function public.set_updated_at();

alter table public.users enable row level security;
alter table public.candidates enable row level security;
alter table public.candidate_resumes enable row level security;
alter table public.candidate_answers enable row level security;
alter table public.question_bank enable row level security;
alter table public.zoho_mailboxes enable row level security;
alter table public.workday_accounts enable row level security;
alter table public.job_links enable row level security;
alter table public.application_runs enable row level security;
alter table public.run_steps enable row level security;
alter table public.extracted_questions enable row level security;
alter table public.mapped_answers enable row level security;
alter table public.manual_review_items enable row level security;
alter table public.otp_logs enable row level security;
alter table public.screenshots enable row level security;
alter table public.automation_logs enable row level security;
alter table public.system_settings enable row level security;
alter table public.audit_logs enable row level security;

create policy users_select on public.users for select using (public.is_admin() or id = auth.uid());
create policy users_insert on public.users for insert with check (public.is_admin() or id = auth.uid());
create policy users_update on public.users for update using (public.is_admin() or id = auth.uid()) with check (public.is_admin() or id = auth.uid());

create policy read_candidates on public.candidates for select using (public.can_view());
create policy write_candidates on public.candidates for all using (public.can_operate()) with check (public.can_operate());
create policy read_candidate_resumes on public.candidate_resumes for select using (public.can_view());
create policy write_candidate_resumes on public.candidate_resumes for all using (public.can_operate()) with check (public.can_operate());
create policy read_candidate_answers on public.candidate_answers for select using (public.can_view());
create policy write_candidate_answers on public.candidate_answers for all using (public.can_operate()) with check (public.can_operate());
create policy read_question_bank on public.question_bank for select using (public.can_view());
create policy write_question_bank on public.question_bank for all using (public.can_operate()) with check (public.can_operate());
create policy read_zoho_mailboxes on public.zoho_mailboxes for select using (public.can_operate());
create policy write_zoho_mailboxes on public.zoho_mailboxes for all using (public.can_operate()) with check (public.can_operate());
create policy read_workday_accounts on public.workday_accounts for select using (public.can_operate());
create policy write_workday_accounts on public.workday_accounts for all using (public.can_operate()) with check (public.can_operate());
create policy read_job_links on public.job_links for select using (public.can_view());
create policy write_job_links on public.job_links for all using (public.can_operate()) with check (public.can_operate());
create policy read_application_runs on public.application_runs for select using (public.can_view());
create policy write_application_runs on public.application_runs for all using (public.can_operate()) with check (public.can_operate());
create policy read_run_steps on public.run_steps for select using (public.can_view());
create policy read_extracted_questions on public.extracted_questions for select using (public.can_view());
create policy read_mapped_answers on public.mapped_answers for select using (public.can_view());
create policy write_mapped_answers on public.mapped_answers for all using (public.can_operate()) with check (public.can_operate());
create policy read_manual_review_items on public.manual_review_items for select using (public.can_view());
create policy write_manual_review_items on public.manual_review_items for all using (public.can_operate()) with check (public.can_operate());
create policy read_otp_logs on public.otp_logs for select using (public.can_operate());
create policy read_screenshots on public.screenshots for select using (public.can_view());
create policy read_automation_logs on public.automation_logs for select using (public.can_operate());
create policy read_system_settings on public.system_settings for select using (public.is_admin() or (public.can_view() and is_sensitive = false));
create policy write_system_settings on public.system_settings for all using (public.is_admin()) with check (public.is_admin());
create policy read_audit_logs on public.audit_logs for select using (public.can_view());
create policy write_audit_logs on public.audit_logs for insert with check (public.is_admin() or actor_user_id = auth.uid());

create or replace function public.claim_next_application_run()
returns table (
  id uuid,
  job_link_id uuid,
  candidate_id uuid,
  status text,
  mode text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with next_run as (
    select application_runs.id
    from public.application_runs
    where application_runs.status = 'queued'
    order by application_runs.created_at asc
    limit 1
    for update skip locked
  )
  update public.application_runs
  set status = 'starting',
      current_step = 'starting',
      started_at = coalesce(started_at, now()),
      updated_at = now()
  from next_run
  where application_runs.id = next_run.id
  returning application_runs.id,
            application_runs.job_link_id,
            application_runs.candidate_id,
            application_runs.status,
            application_runs.mode;
end;
$$;

create or replace function public.calculate_run_readiness(run_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  run_status text;
  unresolved_reviews integer;
  failed_steps integer;
begin
  select status into run_status
  from public.application_runs
  where id = run_id;

  if run_status is null then
    return 'failed';
  end if;

  if run_status = 'failed' then
    return 'failed';
  end if;

  select count(*) into failed_steps
  from public.run_steps
  where application_run_id = run_id
    and step_status = 'failed';

  if failed_steps > 0 then
    return 'blocked';
  end if;

  select count(*) into unresolved_reviews
  from public.manual_review_items
  where application_run_id = run_id
    and status = 'open';

  if unresolved_reviews > 0 then
    return 'needs_review';
  end if;

  if run_status in ('dry_run_complete', 'human_approval_required', 'approved_for_submit') then
    return 'ready';
  end if;

  return 'blocked';
end;
$$;

revoke execute on function public.claim_next_application_run() from public, authenticated;
grant execute on function public.claim_next_application_run() to service_role;
revoke execute on function public.calculate_run_readiness(uuid) from public, authenticated;
grant execute on function public.calculate_run_readiness(uuid) to service_role;

revoke select (access_token_encrypted, refresh_token_encrypted) on public.zoho_mailboxes from anon, authenticated;
revoke select (password_encrypted) on public.workday_accounts from anon, authenticated;

insert into public.system_settings (setting_key, setting_value, description)
values
  ('dry_run_required', 'true'::jsonb, 'V1 requires dry-run mode before submit.'),
  ('human_approval_required', 'true'::jsonb, 'V1 requires human approval before final submit.'),
  ('auto_submit_enabled', 'false'::jsonb, 'Auto-submit is disabled in V1.'),
  ('max_worker_concurrency', '1'::jsonb, 'Default worker concurrency for V1.'),
  ('otp_timeout_seconds', '120'::jsonb, 'Default OTP wait timeout.'),
  ('default_run_mode', '"dry_run"'::jsonb, 'Default application run mode.')
on conflict (setting_key) do update
set setting_value = excluded.setting_value,
    description = excluded.description,
    updated_at = now();

insert into storage.buckets (id, name, public)
values
  ('candidate-resumes', 'candidate-resumes', false),
  ('run-screenshots', 'run-screenshots', false),
  ('playwright-traces', 'playwright-traces', false),
  ('html-captures', 'html-captures', false)
on conflict (id) do update
set public = false;

create policy storage_candidate_resumes_read on storage.objects
  for select using (bucket_id = 'candidate-resumes' and public.can_view());
create policy storage_candidate_resumes_write on storage.objects
  for all using (bucket_id = 'candidate-resumes' and public.can_operate())
  with check (bucket_id = 'candidate-resumes' and public.can_operate());
create policy storage_run_screenshots_read on storage.objects
  for select using (bucket_id = 'run-screenshots' and public.can_view());
create policy storage_debug_artifacts_read on storage.objects
  for select using (bucket_id in ('playwright-traces', 'html-captures') and public.can_operate());
