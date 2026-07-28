drop policy if exists read_workday_accounts on public.workday_accounts;

create policy read_workday_accounts
on public.workday_accounts
for select
using (public.can_view());
