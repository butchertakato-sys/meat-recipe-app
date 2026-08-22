-- schema.sql / seed.sql 実行後のDB単体確認用（データ変更なし）

-- 10テーブルが存在すること。
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'businesses','business_members','products','recipes','recipe_versions',
    'recipe_ingredients','packaging_master','packaging_versions',
    'manufacturing_records','manufacturing_allocations'
  )
order by table_name;

-- 10件であること。
select count(*) as target_table_count
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'businesses','business_members','products','recipes','recipe_versions',
    'recipe_ingredients','packaging_master','packaging_versions',
    'manufacturing_records','manufacturing_allocations'
  );

-- 全対象テーブルでRLSが有効なこと。
select relname as table_name, relrowsecurity as rls_enabled
from pg_class
where relnamespace = 'public'::regnamespace
  and relname in (
    'businesses','business_members','products','recipes','recipe_versions',
    'recipe_ingredients','packaging_master','packaging_versions',
    'manufacturing_records','manufacturing_allocations'
  )
order by relname;

-- 初期商品と確定済み包装versionを確認する。
select internal_code, display_name, manufacturing_type, is_active
from public.products
order by sort_order;

select pm.internal_code, pm.display_name, pv.version_no, pv.unit_type,
       pv.units_per_package, pv.min_units_per_package, pv.max_units_per_package,
       pv.unit_weight_g, pv.package_weight_g, pv.is_current
from public.packaging_master pm
join public.packaging_versions pv on pv.packaging_master_id = pm.id
order by pm.internal_code, pv.version_no;

-- current versionが複数ないこと（0行が正常）。
select recipe_id, count(*)
from public.recipe_versions
where is_current
group by recipe_id having count(*) > 1;

select packaging_master_id, count(*)
from public.packaging_versions
where is_current
group by packaging_master_id having count(*) > 1;

-- FKとRLS policyの存在確認。
select conrelid::regclass as table_name, conname, contype
from pg_constraint
where connamespace = 'public'::regnamespace
order by conrelid::regclass::text, conname;

select schemaname, tablename, policyname, roles, cmd
from pg_policies
where schemaname = 'public'
order by tablename, policyname;

-- authenticatedにDELETE権限がないこと（全行falseが正常）。
select table_name,
       has_table_privilege('authenticated', format('public.%I', table_name), 'DELETE') as authenticated_can_delete
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'businesses','business_members','products','recipes','recipe_versions',
    'recipe_ingredients','packaging_master','packaging_versions',
    'manufacturing_records','manufacturing_allocations'
  )
order by table_name;

-- Authユーザー登録後、この結果が1件以上になること。
select b.name, bm.user_id, bm.role
from public.business_members bm
join public.businesses b on b.id = bm.business_id;
