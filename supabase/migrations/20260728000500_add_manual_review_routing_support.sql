-- Phase 25: allow manual_review_items to hold post-Apply routing outcomes
-- (tenant mismatch, already applied, login/create-account routing, etc.)
-- in addition to the existing question-level review rows. Routing items have
-- no extracted question, so those columns must become optional.

alter table public.manual_review_items
  alter column extracted_question_id drop not null,
  alter column question_text drop not null;

alter table public.manual_review_items
  add column item_type text not null default 'question_review'
    check (item_type in ('question_review', 'routing_review')),
  add column post_apply_state text,
  add column route_reason text,
  add column tenant_key text,
  add column hostname text,
  add column error_code text;

-- Question-review rows must keep the extracted question they reference;
-- routing-review rows have no question and rely on review_reason (already
-- not-null) to carry the routing category.
alter table public.manual_review_items
  add constraint manual_review_items_item_type_shape_chk check (
    item_type <> 'question_review' or (extracted_question_id is not null and question_text is not null)
  );

-- At most one routing-review item per run, so retries of the same run
-- cannot create duplicate queue entries.
create unique index manual_review_items_routing_review_run_unique_idx
  on public.manual_review_items(application_run_id)
  where item_type = 'routing_review';

create index manual_review_items_item_type_idx on public.manual_review_items(item_type);
