-- 食肉加工アプリ Supabase DB Ver.1
-- Supabase SQL Editor で実行する。既存アプリからはまだ接続しない。

begin;

create extension if not exists pgcrypto;

create type public.business_role as enum ('owner', 'admin', 'staff', 'viewer');
create type public.record_status as enum ('active', 'deleted');

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.business_members (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.business_role not null default 'owner',
  created_at timestamptz not null default now(),
  unique (business_id, user_id)
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  internal_code text,
  display_name text not null,
  product_category text,
  manufacturing_type text check (manufacturing_type is null or manufacturing_type in ('own', 'contract')),
  is_active boolean not null default true,
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, internal_code)
);

create table public.recipes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  internal_code text,
  display_name text not null,
  recipe_type text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, internal_code)
);

create table public.recipe_versions (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes(id) on delete restrict,
  version_no integer not null check (version_no > 0),
  effective_from date,
  effective_to date,
  theoretical_weight_g numeric(14,3) check (theoretical_weight_g >= 0),
  base_meat_weight_g numeric(14,3) check (base_meat_weight_g >= 0),
  water_weight_g numeric(14,3) check (water_weight_g >= 0),
  emulsion_weight_g numeric(14,3) check (emulsion_weight_g >= 0),
  casing text,
  length_cm numeric(8,2) check (length_cm >= 0),
  notes text,
  is_current boolean not null default false,
  created_at timestamptz not null default now(),
  unique (recipe_id, version_no),
  check (effective_to is null or effective_from is null or effective_to >= effective_from)
);

create unique index recipe_versions_one_current
  on public.recipe_versions(recipe_id) where is_current;

create table public.recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  recipe_version_id uuid not null references public.recipe_versions(id) on delete cascade,
  ingredient_code text,
  ingredient_name text not null,
  amount_g numeric(14,3) check (amount_g is null or amount_g >= 0),
  percentage numeric(12,6) check (percentage >= 0),
  calculation_type text check (calculation_type is null or calculation_type in ('fixed', 'percentage', 'input')),
  calculation_basis text check (calculation_basis is null or calculation_basis in ('meat', 'meat_plus_water', 'meat_plus_water_plus_emulsion', 'meat_plus_back_fat', 'meat_plus_back_fat_plus_water', 'fixed')),
  allow_manual_override boolean not null default false,
  ingredient_role text,
  sort_order integer not null default 0 check (sort_order >= 0),
  notes text
);

create unique index recipe_ingredients_version_code_unique
  on public.recipe_ingredients(recipe_version_id, ingredient_code)
  where ingredient_code is not null;

create table public.packaging_master (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  internal_code text,
  display_name text not null,
  allocation_type text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, internal_code)
);

create table public.packaging_versions (
  id uuid primary key default gen_random_uuid(),
  packaging_master_id uuid not null references public.packaging_master(id) on delete restrict,
  version_no integer not null check (version_no > 0),
  effective_from date,
  effective_to date,
  unit_type text check (unit_type is null or unit_type in ('package', 'piece', 'weight')),
  units_per_package numeric(12,3) check (units_per_package is null or units_per_package >= 0),
  min_units_per_package numeric(12,3) check (min_units_per_package is null or min_units_per_package >= 0),
  max_units_per_package numeric(12,3) check (max_units_per_package is null or max_units_per_package >= 0),
  unit_weight_g numeric(14,3) check (unit_weight_g is null or unit_weight_g >= 0),
  package_weight_g numeric(14,3) check (package_weight_g >= 0),
  bag_spec text,
  casing text,
  length_cm numeric(8,2) check (length_cm >= 0),
  is_current boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  unique (packaging_master_id, version_no),
  check (effective_to is null or effective_from is null or effective_to >= effective_from),
  check (min_units_per_package is null or max_units_per_package is null or max_units_per_package >= min_units_per_package)
);

create unique index packaging_versions_one_current
  on public.packaging_versions(packaging_master_id) where is_current;

create table public.manufacturing_records (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  recipe_id uuid references public.recipes(id) on delete restrict,
  recipe_version_id uuid references public.recipe_versions(id) on delete restrict,
  prep_date date,
  manufacturing_date date,
  lot_number text,
  manufacturing_type text check (manufacturing_type is null or manufacturing_type in ('own', 'contract')),
  theoretical_weight_g numeric(14,3) check (theoretical_weight_g is null or theoretical_weight_g >= 0),
  completed_weight_g numeric(14,3) check (completed_weight_g is null or completed_weight_g >= 0),
  yield_rate numeric(12,4) check (yield_rate >= 0),
  loss_weight_g numeric(14,3) check (loss_weight_g is null or loss_weight_g >= 0),
  remainder_weight_g numeric(14,3) check (remainder_weight_g is null or remainder_weight_g >= 0),
  memo text,
  status public.record_status not null default 'active',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.manufacturing_allocations (
  id uuid primary key default gen_random_uuid(),
  manufacturing_record_id uuid not null references public.manufacturing_records(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete restrict,
  allocation_type text not null,
  packaging_master_id uuid references public.packaging_master(id) on delete restrict,
  packaging_version_id uuid references public.packaging_versions(id) on delete restrict,
  quantity numeric(14,3) check (quantity is null or quantity >= 0),
  quantity_unit text,
  unit_weight_g numeric(14,3) check (unit_weight_g is null or unit_weight_g >= 0),
  calculated_weight_g numeric(14,3) check (calculated_weight_g is null or calculated_weight_g >= 0),
  count_as_completed_weight boolean not null default true,
  count_as_loss boolean not null default false,
  allocation_code text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index business_members_user_idx on public.business_members(user_id, business_id);
create index products_business_active_idx on public.products(business_id, is_active, sort_order);
create index recipes_product_active_idx on public.recipes(product_id, is_active);
create index recipe_versions_effective_idx on public.recipe_versions(recipe_id, effective_from desc);
create index packaging_master_product_active_idx on public.packaging_master(product_id, is_active);
create index packaging_versions_effective_idx on public.packaging_versions(packaging_master_id, effective_from desc);
create index manufacturing_records_business_date_idx on public.manufacturing_records(business_id, manufacturing_date desc);
create index manufacturing_records_product_idx on public.manufacturing_records(product_id, manufacturing_date desc);
create index manufacturing_allocations_record_idx on public.manufacturing_allocations(manufacturing_record_id);
create index manufacturing_allocations_code_idx on public.manufacturing_allocations(business_id, allocation_code) where allocation_code is not null;

create function public.set_updated_at() returns trigger
language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end $$;

create trigger businesses_updated before update on public.businesses for each row execute function public.set_updated_at();
create trigger products_updated before update on public.products for each row execute function public.set_updated_at();
create trigger recipes_updated before update on public.recipes for each row execute function public.set_updated_at();
create trigger packaging_master_updated before update on public.packaging_master for each row execute function public.set_updated_at();
create trigger manufacturing_records_updated before update on public.manufacturing_records for each row execute function public.set_updated_at();
create trigger manufacturing_allocations_updated before update on public.manufacturing_allocations for each row execute function public.set_updated_at();

-- RLSポリシー内の再帰を避ける所属確認関数。service_roleをブラウザへ置かない。
create function public.is_business_member(target_business_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.business_members bm
    where bm.business_id = target_business_id and bm.user_id = auth.uid()
  );
$$;
revoke all on function public.is_business_member(uuid) from public;
grant execute on function public.is_business_member(uuid) to authenticated;

alter table public.businesses enable row level security;
alter table public.business_members enable row level security;
alter table public.products enable row level security;
alter table public.recipes enable row level security;
alter table public.recipe_versions enable row level security;
alter table public.recipe_ingredients enable row level security;
alter table public.packaging_master enable row level security;
alter table public.packaging_versions enable row level security;
alter table public.manufacturing_records enable row level security;
alter table public.manufacturing_allocations enable row level security;

create policy businesses_select_member on public.businesses for select to authenticated
  using (public.is_business_member(id));
create policy business_members_own_read on public.business_members for select to authenticated
  using (user_id = auth.uid() or public.is_business_member(business_id));

create policy products_select_member on public.products for select to authenticated using (public.is_business_member(business_id));
create policy products_insert_member on public.products for insert to authenticated with check (public.is_business_member(business_id));
create policy products_update_member on public.products for update to authenticated using (public.is_business_member(business_id)) with check (public.is_business_member(business_id));

create policy recipes_select_member on public.recipes for select to authenticated using (public.is_business_member(business_id));
create policy recipes_insert_member on public.recipes for insert to authenticated with check (public.is_business_member(business_id));
create policy recipes_update_member on public.recipes for update to authenticated using (public.is_business_member(business_id)) with check (public.is_business_member(business_id));

create policy recipe_versions_select_member on public.recipe_versions for select to authenticated
  using (exists (select 1 from public.recipes r where r.id = recipe_id and public.is_business_member(r.business_id)));
create policy recipe_versions_insert_member on public.recipe_versions for insert to authenticated
  with check (exists (select 1 from public.recipes r where r.id = recipe_id and public.is_business_member(r.business_id)));
create policy recipe_versions_update_member on public.recipe_versions for update to authenticated
  using (exists (select 1 from public.recipes r where r.id = recipe_id and public.is_business_member(r.business_id)))
  with check (exists (select 1 from public.recipes r where r.id = recipe_id and public.is_business_member(r.business_id)));

create policy recipe_ingredients_select_member on public.recipe_ingredients for select to authenticated
  using (exists (select 1 from public.recipe_versions rv join public.recipes r on r.id = rv.recipe_id where rv.id = recipe_version_id and public.is_business_member(r.business_id)));
create policy recipe_ingredients_insert_member on public.recipe_ingredients for insert to authenticated
  with check (exists (select 1 from public.recipe_versions rv join public.recipes r on r.id = rv.recipe_id where rv.id = recipe_version_id and public.is_business_member(r.business_id)));
create policy recipe_ingredients_update_member on public.recipe_ingredients for update to authenticated
  using (exists (select 1 from public.recipe_versions rv join public.recipes r on r.id = rv.recipe_id where rv.id = recipe_version_id and public.is_business_member(r.business_id)))
  with check (exists (select 1 from public.recipe_versions rv join public.recipes r on r.id = rv.recipe_id where rv.id = recipe_version_id and public.is_business_member(r.business_id)));

create policy packaging_master_select_member on public.packaging_master for select to authenticated using (public.is_business_member(business_id));
create policy packaging_master_insert_member on public.packaging_master for insert to authenticated with check (public.is_business_member(business_id));
create policy packaging_master_update_member on public.packaging_master for update to authenticated using (public.is_business_member(business_id)) with check (public.is_business_member(business_id));

create policy packaging_versions_select_member on public.packaging_versions for select to authenticated
  using (exists (select 1 from public.packaging_master pm where pm.id = packaging_master_id and public.is_business_member(pm.business_id)));
create policy packaging_versions_insert_member on public.packaging_versions for insert to authenticated
  with check (exists (select 1 from public.packaging_master pm where pm.id = packaging_master_id and public.is_business_member(pm.business_id)));
create policy packaging_versions_update_member on public.packaging_versions for update to authenticated
  using (exists (select 1 from public.packaging_master pm where pm.id = packaging_master_id and public.is_business_member(pm.business_id)))
  with check (exists (select 1 from public.packaging_master pm where pm.id = packaging_master_id and public.is_business_member(pm.business_id)));

create policy manufacturing_records_select_member on public.manufacturing_records for select to authenticated using (public.is_business_member(business_id));
create policy manufacturing_records_insert_member on public.manufacturing_records for insert to authenticated with check (public.is_business_member(business_id));
create policy manufacturing_records_update_member on public.manufacturing_records for update to authenticated using (public.is_business_member(business_id)) with check (public.is_business_member(business_id));

create policy manufacturing_allocations_select_member on public.manufacturing_allocations for select to authenticated using (public.is_business_member(business_id));
create policy manufacturing_allocations_insert_member on public.manufacturing_allocations for insert to authenticated with check (public.is_business_member(business_id));
create policy manufacturing_allocations_update_member on public.manufacturing_allocations for update to authenticated using (public.is_business_member(business_id)) with check (public.is_business_member(business_id));

grant usage on schema public to authenticated;
grant select on public.businesses, public.business_members to authenticated;
grant select, insert, update on public.products, public.recipes, public.recipe_versions,
  public.recipe_ingredients, public.packaging_master, public.packaging_versions,
  public.manufacturing_records, public.manufacturing_allocations to authenticated;
revoke delete on public.businesses, public.business_members, public.products, public.recipes,
  public.recipe_versions, public.recipe_ingredients, public.packaging_master,
  public.packaging_versions, public.manufacturing_records, public.manufacturing_allocations
  from authenticated;

-- recordとallocationsを一括upsertするRPC。同じクライアントUUIDの再送は二重登録しない。
-- どれかが失敗すれば全体をrollbackする。
create function public.save_manufacturing_record(
  record_data jsonb,
  allocation_data jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  record_id uuid := (record_data->>'id')::uuid;
  target_business_id uuid := (record_data->>'business_id')::uuid;
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
    status, created_by, created_at, updated_at
  ) values (
    record_id, target_business_id, (record_data->>'product_id')::uuid,
    (record_data->>'recipe_id')::uuid, (record_data->>'recipe_version_id')::uuid,
    (record_data->>'prep_date')::date, (record_data->>'manufacturing_date')::date,
    record_data->>'lot_number', record_data->>'manufacturing_type',
    (record_data->>'theoretical_weight_g')::numeric, (record_data->>'completed_weight_g')::numeric,
    nullif(record_data->>'yield_rate','')::numeric,
    coalesce(nullif(record_data->>'loss_weight_g','')::numeric, 0),
    coalesce(nullif(record_data->>'remainder_weight_g','')::numeric, 0), record_data->>'memo',
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
    status = excluded.status,
    updated_at = excluded.updated_at
  where public.manufacturing_records.business_id = target_business_id;

  if not found then
    raise exception 'manufacturing record business_id mismatch';
  end if;

  -- 編集時もrecordと内訳を同一トランザクションで置換する。
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
  return record_id;
end $$;
revoke all on function public.save_manufacturing_record(jsonb, jsonb) from public;
grant execute on function public.save_manufacturing_record(jsonb, jsonb) to authenticated;

commit;
