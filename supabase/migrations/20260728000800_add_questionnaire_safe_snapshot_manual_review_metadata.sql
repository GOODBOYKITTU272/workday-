-- Phase 31: store allow-listed questionnaire safe-snapshot summary metadata on routing-review rows.
alter table public.manual_review_items
  add column questionnaire_snapshot_detected boolean,
  add column questionnaire_snapshot_field_count integer,
  add column questionnaire_snapshot_required_field_count integer,
  add column questionnaire_snapshot_upload_field_signal_detected boolean,
  add column questionnaire_snapshot_text_field_count integer,
  add column questionnaire_snapshot_select_field_count integer,
  add column questionnaire_snapshot_checkbox_field_count integer,
  add column questionnaire_snapshot_radio_field_count integer,
  add column questionnaire_snapshot_textarea_field_count integer,
  add column questionnaire_snapshot_unknown_field_count integer,
  add column questionnaire_snapshot_confidence text;
