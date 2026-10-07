-- Cross-device data integration for meat-recipe-app
-- Apply once to the existing Supabase project before enabling the client migration.
begin;

-- Preserve the complete legacy app payload so another device can reconstruct
-- the same manufacturing detail screen without depending on localStorage.
alter table public.manufacturing_records
  add column if not exists legacy_payload jsonb not null default '{}'::jsonb;

-- Saved recipe calculations were previously device-local only.
create table if not exists public.saved_recipe_calculations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  source_device_id uuid,
  prep_date date,
  category text,
  recipe_name text,
  payload jsonb not null default '{}'::jsonb,
  status public.record_status not null default 'active',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists saved_recipe_calculations_business_date_idx
  on public.saved_recipe_calculations(business_id, prep_date desc);

drop trigger if exists saved_recipe_calculations_updated on public.saved_recipe_calculations;
create trigger saved_recipe_calculations_updated
  before update on public.saved_recipe_calculations
  for each row execute function public.set_updated_at();

alter table public.saved_recipe_calculations enable row level security;

drop policy if exists saved_recipe_calculations_select_member on public.saved_recipe_calculations;
create policy saved_recipe_calculations_select_member
  on public.saved_recipe_calculations for select to authenticated
  using (public.is_business_member(business_id));

drop policy if exists saved_recipe_calculations_insert_member on public.saved_recipe_calculations;
create policy saved_recipe_calculations_insert_member
  on public.saved_recipe_calculations for insert to authenticated
  with check (public.is_business_member(business_id));

drop policy if exists saved_recipe_calculations_update_member on public.saved_recipe_calculations;
create policy saved_recipe_calculations_update_member
  on public.saved_recipe_calculations for update to authenticated
  using (public.is_business_member(business_id))
  with check (public.is_business_member(business_id));

grant select, insert, update on public.saved_recipe_calculations to authenticated;
revoke delete on public.saved_recipe_calculations from authenticated;

-- LOT numbers are business-wide identifiers. Prevent two devices from creating
-- separate active manufacturing records with the same LOT.
create unique index if not exists manufacturing_records_business_lot_active_unique
  on public.manufacturing_records(business_id, lot_number)
  where status = 'active' and lot_number is not null and btrim(lot_number) <> '';

-- Online LOT reservation prevents two devices from receiving the same suffix.
create table if not exists public.manufacturing_lot_reservations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  lot_base text not null,
  lot_number text not null,
  record_id uuid not null,
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  created_at timestamptz not null default now(),
  unique (business_id, lot_number),
  unique (business_id, record_id)
);

alter table public.manufacturing_lot_reservations enable row level security;
revoke all on public.manufacturing_lot_reservations from public, authenticated;

create or replace function public.reserve_manufacturing_lot(
  target_business_id uuid,
  target_lot_base text,
  target_record_id uuid
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_lot text;
  next_no integer;
  candidate text;
begin
  if not public.is_business_member(target_business_id) then
    raise exception 'not a member of the target business';
  end if;
  if coalesce(btrim(target_lot_base), '') = '' then
    raise exception 'lot base is required';
  end if;

  perform pg_advisory_xact_lock(hashtext(target_business_id::text || ':' || target_lot_base));

  delete from public.manufacturing_lot_reservations
   where business_id = target_business_id and expires_at < now();

  select lot_number into existing_lot
    from public.manufacturing_lot_reservations
   where business_id = target_business_id and record_id = target_record_id;

  if existing_lot is not null then
    return existing_lot;
  end if;

  select coalesce(max(seq), 0) + 1 into next_no
  from (
    select substring(mr.lot_number from '([0-9]+)

  insert into public.manufacturing_lot_reservations(
    business_id, lot_base, lot_number, record_id
  ) values (
    target_business_id, target_lot_base, candidate, target_record_id
  );

  return candidate;
end $$;

revoke all on function public.reserve_manufacturing_lot(uuid, text, uuid) from public;
grant execute on function public.reserve_manufacturing_lot(uuid, text, uuid) to authenticated;

-- Keep the original atomic manufacturing upsert, now persisting legacy_payload
-- and consuming any LOT reservation owned by this record.
create or replace function public.save_manufacturing_record(
  record_data jsonb,
  allocation_data jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  record_id uuid := (record_data->>'id')::uuid;
  target_business_id uuid := (record_data->>'business_id')::uuid;
  requested_lot text := record_data->>'lot_number';
begin
  if not public.is_business_member(target_business_id) then
    raise exception 'not a member of the target business';
  end if;

  if not exists (
    select 1 from public.products p
    where p.id = (record_data->>'product_id')::uuid
      and p.business_id = target_business_id
  ) or not exists (
    select 1 from public.recipes r
    where r.id = (record_data->>'recipe_id')::uuid
      and r.product_id = (record_data->>'product_id')::uuid
      and r.business_id = target_business_id
  ) or not exists (
    select 1 from public.recipe_versions rv
    where rv.id = (record_data->>'recipe_version_id')::uuid
      and rv.recipe_id = (record_data->>'recipe_id')::uuid
  ) then
    raise exception 'record master IDs do not belong to the target business';
  end if;

  if requested_lot is not null and btrim(requested_lot) <> '' and exists (
    select 1 from public.manufacturing_records mr
     where mr.business_id = target_business_id
       and mr.lot_number = requested_lot
       and mr.status = 'active'
       and mr.id <> record_id
  ) then
    raise exception 'LOT_CONFLICT:%', requested_lot;
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(coalesce(allocation_data, '[]'::jsonb)) as a(
      packaging_master_id uuid, packaging_version_id uuid
    )
    left join public.packaging_master pm on pm.id = a.packaging_master_id
    left join public.packaging_versions pv on pv.id = a.packaging_version_id
    where (a.packaging_master_id is not null and (pm.id is null or pm.business_id <> target_business_id))
       or (a.packaging_version_id is not null and (pv.id is null or pv.packaging_master_id is distinct from a.packaging_master_id))
  ) then
    raise exception 'allocation master IDs do not belong to the target business';
  end if;

  insert into public.manufacturing_records (
    id, business_id, product_id, recipe_id, recipe_version_id, prep_date,
    manufacturing_date, lot_number, manufacturing_type, theoretical_weight_g,
    completed_weight_g, yield_rate, loss_weight_g, remainder_weight_g, memo,
    legacy_payload, status, created_by, created_at, updated_at
  ) values (
    record_id, target_business_id, (record_data->>'product_id')::uuid,
    (record_data->>'recipe_id')::uuid, (record_data->>'recipe_version_id')::uuid,
    (record_data->>'prep_date')::date, (record_data->>'manufacturing_date')::date,
    requested_lot, record_data->>'manufacturing_type',
    (record_data->>'theoretical_weight_g')::numeric, (record_data->>'completed_weight_g')::numeric,
    nullif(record_data->>'yield_rate','')::numeric,
    coalesce(nullif(record_data->>'loss_weight_g','')::numeric, 0),
    coalesce(nullif(record_data->>'remainder_weight_g','')::numeric, 0),
    record_data->>'memo',
    coalesce(record_data->'legacy_payload', '{}'::jsonb),
    coalesce((record_data->>'status')::public.record_status, 'active'), auth.uid(),
    coalesce((record_data->>'created_at')::timestamptz, now()),
    coalesce((record_data->>'updated_at')::timestamptz, now())
  )
  on conflict (id) do update set
    product_id = excluded.product_id,
    recipe_id = excluded.recipe_id,
    recipe_version_id = excluded.recipe_version_id,
    prep_date = excluded.prep_date,
    manufacturing_date = excluded.manufacturing_date,
    lot_number = excluded.lot_number,
    manufacturing_type = excluded.manufacturing_type,
    theoretical_weight_g = excluded.theoretical_weight_g,
    completed_weight_g = excluded.completed_weight_g,
    yield_rate = excluded.yield_rate,
    loss_weight_g = excluded.loss_weight_g,
    remainder_weight_g = excluded.remainder_weight_g,
    memo = excluded.memo,
    legacy_payload = excluded.legacy_payload,
    status = excluded.status,
    updated_at = excluded.updated_at
  where public.manufacturing_records.business_id = target_business_id;

  if not found then
    raise exception 'manufacturing record business_id mismatch';
  end if;

  delete from public.manufacturing_allocations
  where manufacturing_record_id = record_id and business_id = target_business_id;

  insert into public.manufacturing_allocations (
    id, manufacturing_record_id, business_id, allocation_type, packaging_master_id,
    packaging_version_id, quantity, quantity_unit, unit_weight_g,
    calculated_weight_g, count_as_completed_weight, count_as_loss,
    allocation_code, notes, created_at, updated_at
  )
  select x.id, record_id, target_business_id, x.allocation_type,
    x.packaging_master_id, x.packaging_version_id, x.quantity, x.quantity_unit,
    x.unit_weight_g, x.calculated_weight_g, x.count_as_completed_weight,
    x.count_as_loss, x.allocation_code, x.notes,
    coalesce(x.created_at, now()), coalesce(x.updated_at, now())
  from jsonb_to_recordset(coalesce(allocation_data, '[]'::jsonb)) as x(
    id uuid, allocation_type text, packaging_master_id uuid, packaging_version_id uuid,
    quantity numeric, quantity_unit text, unit_weight_g numeric,
    calculated_weight_g numeric, count_as_completed_weight boolean,
    count_as_loss boolean, allocation_code text, notes text,
    created_at timestamptz, updated_at timestamptz
  );

  delete from public.manufacturing_lot_reservations
   where business_id = target_business_id and record_id = save_manufacturing_record.record_id;

  return record_id;
end $$;

revoke all on function public.save_manufacturing_record(jsonb, jsonb) from public;
grant execute on function public.save_manufacturing_record(jsonb, jsonb) to authenticated;

commit;
)::integer as seq
    from public.manufacturing_records mr
    where mr.business_id = target_business_id
      and mr.status = 'active'
      and mr.lot_number like target_lot_base || '-%'
    union all
    select substring(lr.lot_number from '([0-9]+)

  insert into public.manufacturing_lot_reservations(
    business_id, lot_base, lot_number, record_id
  ) values (
    target_business_id, lot_base, candidate, target_record_id
  );

  return candidate;
end $$;

revoke all on function public.reserve_manufacturing_lot(uuid, text, uuid) from public;
grant execute on function public.reserve_manufacturing_lot(uuid, text, uuid) to authenticated;

-- Keep the original atomic manufacturing upsert, now persisting legacy_payload
-- and consuming any LOT reservation owned by this record.
create or replace function public.save_manufacturing_record(
  record_data jsonb,
  allocation_data jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  record_id uuid := (record_data->>'id')::uuid;
  target_business_id uuid := (record_data->>'business_id')::uuid;
  requested_lot text := record_data->>'lot_number';
begin
  if not public.is_business_member(target_business_id) then
    raise exception 'not a member of the target business';
  end if;

  if not exists (
    select 1 from public.products p
    where p.id = (record_data->>'product_id')::uuid
      and p.business_id = target_business_id
  ) or not exists (
    select 1 from public.recipes r
    where r.id = (record_data->>'recipe_id')::uuid
      and r.product_id = (record_data->>'product_id')::uuid
      and r.business_id = target_business_id
  ) or not exists (
    select 1 from public.recipe_versions rv
    where rv.id = (record_data->>'recipe_version_id')::uuid
      and rv.recipe_id = (record_data->>'recipe_id')::uuid
  ) then
    raise exception 'record master IDs do not belong to the target business';
  end if;

  if requested_lot is not null and btrim(requested_lot) <> '' and exists (
    select 1 from public.manufacturing_records mr
     where mr.business_id = target_business_id
       and mr.lot_number = requested_lot
       and mr.status = 'active'
       and mr.id <> record_id
  ) then
    raise exception 'LOT_CONFLICT:%', requested_lot;
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(coalesce(allocation_data, '[]'::jsonb)) as a(
      packaging_master_id uuid, packaging_version_id uuid
    )
    left join public.packaging_master pm on pm.id = a.packaging_master_id
    left join public.packaging_versions pv on pv.id = a.packaging_version_id
    where (a.packaging_master_id is not null and (pm.id is null or pm.business_id <> target_business_id))
       or (a.packaging_version_id is not null and (pv.id is null or pv.packaging_master_id is distinct from a.packaging_master_id))
  ) then
    raise exception 'allocation master IDs do not belong to the target business';
  end if;

  insert into public.manufacturing_records (
    id, business_id, product_id, recipe_id, recipe_version_id, prep_date,
    manufacturing_date, lot_number, manufacturing_type, theoretical_weight_g,
    completed_weight_g, yield_rate, loss_weight_g, remainder_weight_g, memo,
    legacy_payload, status, created_by, created_at, updated_at
  ) values (
    record_id, target_business_id, (record_data->>'product_id')::uuid,
    (record_data->>'recipe_id')::uuid, (record_data->>'recipe_version_id')::uuid,
    (record_data->>'prep_date')::date, (record_data->>'manufacturing_date')::date,
    requested_lot, record_data->>'manufacturing_type',
    (record_data->>'theoretical_weight_g')::numeric, (record_data->>'completed_weight_g')::numeric,
    nullif(record_data->>'yield_rate','')::numeric,
    coalesce(nullif(record_data->>'loss_weight_g','')::numeric, 0),
    coalesce(nullif(record_data->>'remainder_weight_g','')::numeric, 0),
    record_data->>'memo',
    coalesce(record_data->'legacy_payload', '{}'::jsonb),
    coalesce((record_data->>'status')::public.record_status, 'active'), auth.uid(),
    coalesce((record_data->>'created_at')::timestamptz, now()),
    coalesce((record_data->>'updated_at')::timestamptz, now())
  )
  on conflict (id) do update set
    product_id = excluded.product_id,
    recipe_id = excluded.recipe_id,
    recipe_version_id = excluded.recipe_version_id,
    prep_date = excluded.prep_date,
    manufacturing_date = excluded.manufacturing_date,
    lot_number = excluded.lot_number,
    manufacturing_type = excluded.manufacturing_type,
    theoretical_weight_g = excluded.theoretical_weight_g,
    completed_weight_g = excluded.completed_weight_g,
    yield_rate = excluded.yield_rate,
    loss_weight_g = excluded.loss_weight_g,
    remainder_weight_g = excluded.remainder_weight_g,
    memo = excluded.memo,
    legacy_payload = excluded.legacy_payload,
    status = excluded.status,
    updated_at = excluded.updated_at
  where public.manufacturing_records.business_id = target_business_id;

  if not found then
    raise exception 'manufacturing record business_id mismatch';
  end if;

  delete from public.manufacturing_allocations
  where manufacturing_record_id = record_id and business_id = target_business_id;

  insert into public.manufacturing_allocations (
    id, manufacturing_record_id, business_id, allocation_type, packaging_master_id,
    packaging_version_id, quantity, quantity_unit, unit_weight_g,
    calculated_weight_g, count_as_completed_weight, count_as_loss,
    allocation_code, notes, created_at, updated_at
  )
  select x.id, record_id, target_business_id, x.allocation_type,
    x.packaging_master_id, x.packaging_version_id, x.quantity, x.quantity_unit,
    x.unit_weight_g, x.calculated_weight_g, x.count_as_completed_weight,
    x.count_as_loss, x.allocation_code, x.notes,
    coalesce(x.created_at, now()), coalesce(x.updated_at, now())
  from jsonb_to_recordset(coalesce(allocation_data, '[]'::jsonb)) as x(
    id uuid, allocation_type text, packaging_master_id uuid, packaging_version_id uuid,
    quantity numeric, quantity_unit text, unit_weight_g numeric,
    calculated_weight_g numeric, count_as_completed_weight boolean,
    count_as_loss boolean, allocation_code text, notes text,
    created_at timestamptz, updated_at timestamptz
  );

  delete from public.manufacturing_lot_reservations
   where business_id = target_business_id and record_id = save_manufacturing_record.record_id;

  return record_id;
end $$;

revoke all on function public.save_manufacturing_record(jsonb, jsonb) from public;
grant execute on function public.save_manufacturing_record(jsonb, jsonb) to authenticated;

commit;
)::integer as seq
    from public.manufacturing_lot_reservations lr
    where lr.business_id = target_business_id
      and lr.lot_base = target_lot_base
      and lr.expires_at >= now()
  ) numbered;

  candidate := target_lot_base || '-' || lpad(next_no::text, 2, '0');

  insert into public.manufacturing_lot_reservations(
    business_id, lot_base, lot_number, record_id
  ) values (
    target_business_id, lot_base, candidate, target_record_id
  );

  return candidate;
end $$;

revoke all on function public.reserve_manufacturing_lot(uuid, text, uuid) from public;
grant execute on function public.reserve_manufacturing_lot(uuid, text, uuid) to authenticated;

-- Keep the original atomic manufacturing upsert, now persisting legacy_payload
-- and consuming any LOT reservation owned by this record.
create or replace function public.save_manufacturing_record(
  record_data jsonb,
  allocation_data jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  record_id uuid := (record_data->>'id')::uuid;
  target_business_id uuid := (record_data->>'business_id')::uuid;
  requested_lot text := record_data->>'lot_number';
begin
  if not public.is_business_member(target_business_id) then
    raise exception 'not a member of the target business';
  end if;

  if not exists (
    select 1 from public.products p
    where p.id = (record_data->>'product_id')::uuid
      and p.business_id = target_business_id
  ) or not exists (
    select 1 from public.recipes r
    where r.id = (record_data->>'recipe_id')::uuid
      and r.product_id = (record_data->>'product_id')::uuid
      and r.business_id = target_business_id
  ) or not exists (
    select 1 from public.recipe_versions rv
    where rv.id = (record_data->>'recipe_version_id')::uuid
      and rv.recipe_id = (record_data->>'recipe_id')::uuid
  ) then
    raise exception 'record master IDs do not belong to the target business';
  end if;

  if requested_lot is not null and btrim(requested_lot) <> '' and exists (
    select 1 from public.manufacturing_records mr
     where mr.business_id = target_business_id
       and mr.lot_number = requested_lot
       and mr.status = 'active'
       and mr.id <> record_id
  ) then
    raise exception 'LOT_CONFLICT:%', requested_lot;
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(coalesce(allocation_data, '[]'::jsonb)) as a(
      packaging_master_id uuid, packaging_version_id uuid
    )
    left join public.packaging_master pm on pm.id = a.packaging_master_id
    left join public.packaging_versions pv on pv.id = a.packaging_version_id
    where (a.packaging_master_id is not null and (pm.id is null or pm.business_id <> target_business_id))
       or (a.packaging_version_id is not null and (pv.id is null or pv.packaging_master_id is distinct from a.packaging_master_id))
  ) then
    raise exception 'allocation master IDs do not belong to the target business';
  end if;

  insert into public.manufacturing_records (
    id, business_id, product_id, recipe_id, recipe_version_id, prep_date,
    manufacturing_date, lot_number, manufacturing_type, theoretical_weight_g,
    completed_weight_g, yield_rate, loss_weight_g, remainder_weight_g, memo,
    legacy_payload, status, created_by, created_at, updated_at
  ) values (
    record_id, target_business_id, (record_data->>'product_id')::uuid,
    (record_data->>'recipe_id')::uuid, (record_data->>'recipe_version_id')::uuid,
    (record_data->>'prep_date')::date, (record_data->>'manufacturing_date')::date,
    requested_lot, record_data->>'manufacturing_type',
    (record_data->>'theoretical_weight_g')::numeric, (record_data->>'completed_weight_g')::numeric,
    nullif(record_data->>'yield_rate','')::numeric,
    coalesce(nullif(record_data->>'loss_weight_g','')::numeric, 0),
    coalesce(nullif(record_data->>'remainder_weight_g','')::numeric, 0),
    record_data->>'memo',
    coalesce(record_data->'legacy_payload', '{}'::jsonb),
    coalesce((record_data->>'status')::public.record_status, 'active'), auth.uid(),
    coalesce((record_data->>'created_at')::timestamptz, now()),
    coalesce((record_data->>'updated_at')::timestamptz, now())
  )
  on conflict (id) do update set
    product_id = excluded.product_id,
    recipe_id = excluded.recipe_id,
    recipe_version_id = excluded.recipe_version_id,
    prep_date = excluded.prep_date,
    manufacturing_date = excluded.manufacturing_date,
    lot_number = excluded.lot_number,
    manufacturing_type = excluded.manufacturing_type,
    theoretical_weight_g = excluded.theoretical_weight_g,
    completed_weight_g = excluded.completed_weight_g,
    yield_rate = excluded.yield_rate,
    loss_weight_g = excluded.loss_weight_g,
    remainder_weight_g = excluded.remainder_weight_g,
    memo = excluded.memo,
    legacy_payload = excluded.legacy_payload,
    status = excluded.status,
    updated_at = excluded.updated_at
  where public.manufacturing_records.business_id = target_business_id;

  if not found then
    raise exception 'manufacturing record business_id mismatch';
  end if;

  delete from public.manufacturing_allocations
  where manufacturing_record_id = record_id and business_id = target_business_id;

  insert into public.manufacturing_allocations (
    id, manufacturing_record_id, business_id, allocation_type, packaging_master_id,
    packaging_version_id, quantity, quantity_unit, unit_weight_g,
    calculated_weight_g, count_as_completed_weight, count_as_loss,
    allocation_code, notes, created_at, updated_at
  )
  select x.id, record_id, target_business_id, x.allocation_type,
    x.packaging_master_id, x.packaging_version_id, x.quantity, x.quantity_unit,
    x.unit_weight_g, x.calculated_weight_g, x.count_as_completed_weight,
    x.count_as_loss, x.allocation_code, x.notes,
    coalesce(x.created_at, now()), coalesce(x.updated_at, now())
  from jsonb_to_recordset(coalesce(allocation_data, '[]'::jsonb)) as x(
    id uuid, allocation_type text, packaging_master_id uuid, packaging_version_id uuid,
    quantity numeric, quantity_unit text, unit_weight_g numeric,
    calculated_weight_g numeric, count_as_completed_weight boolean,
    count_as_loss boolean, allocation_code text, notes text,
    created_at timestamptz, updated_at timestamptz
  );

  delete from public.manufacturing_lot_reservations
   where business_id = target_business_id and record_id = save_manufacturing_record.record_id;

  return record_id;
end $$;

revoke all on function public.save_manufacturing_record(jsonb, jsonb) from public;
grant execute on function public.save_manufacturing_record(jsonb, jsonb) to authenticated;

commit;
