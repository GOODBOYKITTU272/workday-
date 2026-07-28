-- Phase 29: store fixed post-login routing metadata on routing-review rows.
alter table public.manual_review_items
  add column post_login_state text,
  add column post_login_route text;
