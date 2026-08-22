-- 食肉加工アプリ: 包装本数範囲の追加
-- 既存テーブル・既存行を削除・更新せず、山小屋など可変本数包装を表現する。

begin;

alter table public.packaging_versions
  add column if not exists min_units_per_package numeric(12,3),
  add column if not exists max_units_per_package numeric(12,3);

alter table public.packaging_versions
  drop constraint if exists packaging_versions_min_units_per_package_check,
  add constraint packaging_versions_min_units_per_package_check
    check (min_units_per_package is null or min_units_per_package >= 0),
  drop constraint if exists packaging_versions_max_units_per_package_check,
  add constraint packaging_versions_max_units_per_package_check
    check (max_units_per_package is null or max_units_per_package >= 0),
  drop constraint if exists packaging_versions_unit_range_check,
  add constraint packaging_versions_unit_range_check
    check (
      min_units_per_package is null
      or max_units_per_package is null
      or max_units_per_package >= min_units_per_package
    );

comment on column public.packaging_versions.min_units_per_package is
  '1包装あたり本数が範囲指定の場合の最小本数。固定本数ではNULL';
comment on column public.packaging_versions.max_units_per_package is
  '1包装あたり本数が範囲指定の場合の最大本数。固定本数ではNULL';

commit;
