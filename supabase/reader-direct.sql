-- Run in the same Supabase project after reader-pairing.sql.
-- Replaces only the existing reader RPC. The paired reader can resolve one
-- scanned UID against its owner's library without an open browser tab.
create or replace function public.reader_exchange(
  reader_id uuid, device_token text, is_connected boolean,
  event_id uuid default null, tag_uid text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  reader public.library_readers;
  matched_cd jsonb;
begin
  if length(device_token) <> 64 then raise exception 'Reader credential invalid'; end if;
  select * into reader from public.library_readers
    where id = reader_id and token_hash = encode(sha256(convert_to(device_token, 'UTF8')), 'hex') for update;
  if not found then raise exception 'Reader revoked or credential invalid'; end if;
  if event_id is not null and (tag_uid is null or tag_uid !~ '^([0-9A-F]{2}:){3,9}[0-9A-F]{2}$') then
    raise exception 'Invalid tag UID';
  end if;
  update public.library_readers set last_seen = now(), connected = is_connected where id = reader.id;
  if event_id is not null and event_id is distinct from reader.scan_id then
    update public.library_readers set scan_id = event_id, uid = tag_uid, scanned_at = now(),
      response_scan_id = null, response_cd = null where id = reader.id;
    reader.scan_id := event_id;
    reader.uid := tag_uid;
    reader.response_scan_id := null;
    reader.response_cd := null;
  end if;
  if reader.scan_id is null then
    return jsonb_build_object('ack', null, 'resolved', false);
  end if;
  -- Resolve against current account links on every poll so adding/removing a
  -- CD takes effect even if the website was closed after the original scan.
  select jsonb_build_object(
    'id', c.id, 'album', c.payload->>'album', 'artist', c.payload->>'artist',
    'releaseGroupId', c.payload->>'releaseGroupId',
    'trackCount', jsonb_array_length(coalesce(c.payload::jsonb->'tracks', '[]'::jsonb))
  ) into matched_cd
  from public.tag_links as link
  join public.cds as c on c.id = link.cd_id and c.user_id = reader.user_id
  where link.uid = reader.uid and link.user_id = reader.user_id;
  return jsonb_build_object('ack', reader.scan_id, 'resolved', true, 'cd', matched_cd);
end;
$$;
revoke all on function public.reader_exchange(uuid,text,boolean,uuid,text) from public, anon, authenticated;
grant execute on function public.reader_exchange(uuid,text,boolean,uuid,text) to anon;
