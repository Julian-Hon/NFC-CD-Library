-- Run once in this project's Supabase SQL editor.
-- Only the signed-in owner may create, inspect, or revoke a reader.
create table if not exists public.library_readers (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  last_seen timestamptz,
  connected boolean not null default false,
  scan_id uuid,
  uid text,
  scanned_at timestamptz,
  response_scan_id uuid,
  response_cd jsonb
);
alter table public.library_readers enable row level security;
create policy reader_owner_select on public.library_readers for select to authenticated using (user_id = auth.uid());
create policy reader_owner_insert on public.library_readers for insert to authenticated with check (user_id = auth.uid());
create policy reader_owner_delete on public.library_readers for delete to authenticated using (user_id = auth.uid());
create policy reader_owner_response on public.library_readers for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.library_readers from anon, authenticated;
grant select, delete on public.library_readers to authenticated;
grant insert (id, name, token_hash) on public.library_readers to authenticated;
grant update (response_scan_id, response_cd) on public.library_readers to authenticated;

-- Device credentials authorize only heartbeat/scan submission and the response
-- to that same reader. They cannot read the owner's library or sign in as them.
create or replace function public.reader_exchange(
  reader_id uuid, device_token text, is_connected boolean,
  event_id uuid default null, tag_uid text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.library_readers;
begin
  if length(device_token) <> 64 then raise exception 'Reader credential invalid'; end if;
  select * into r from public.library_readers
    where id = reader_id and token_hash = encode(sha256(convert_to(device_token, 'UTF8')), 'hex') for update;
  if not found then raise exception 'Reader revoked or credential invalid'; end if;
  if event_id is not null and (tag_uid is null or tag_uid !~ '^([0-9A-F]{2}:){3,9}[0-9A-F]{2}$') then
    raise exception 'Invalid tag UID';
  end if;
  update public.library_readers set last_seen = now(), connected = is_connected where id = r.id;
  if event_id is not null and event_id is distinct from r.scan_id then
    update public.library_readers set scan_id = event_id, uid = tag_uid, scanned_at = now(),
      response_scan_id = null, response_cd = null where id = r.id;
    return jsonb_build_object('ack', event_id, 'resolved', false);
  end if;
  return jsonb_build_object('ack', r.scan_id, 'resolved', r.response_scan_id = r.scan_id,
    'cd', case when r.response_scan_id = r.scan_id then r.response_cd else null end);
end;
$$;
revoke all on function public.reader_exchange(uuid,text,boolean,uuid,text) from public, anon, authenticated;
grant execute on function public.reader_exchange(uuid,text,boolean,uuid,text) to anon;
