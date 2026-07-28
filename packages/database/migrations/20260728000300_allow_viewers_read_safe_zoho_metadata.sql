drop policy if exists read_zoho_mailboxes on public.zoho_mailboxes;

create policy read_zoho_mailboxes
on public.zoho_mailboxes
for select
using (public.can_view());
