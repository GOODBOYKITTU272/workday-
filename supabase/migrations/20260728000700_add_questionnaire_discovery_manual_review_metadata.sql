-- Phase 30: store allow-listed questionnaire discovery metadata on routing-review rows.
alter table public.manual_review_items
  add column questionnaire_page_detected boolean,
  add column application_form_detected boolean,
  add column form_signals_detected boolean,
  add column resume_upload_signal_detected boolean,
  add column required_fields_signal_detected boolean,
  add column questionnaire_detection_confidence text;
