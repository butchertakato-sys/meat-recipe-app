-- 食肉加工アプリ: 可変レシピ計算基準の追加
-- 既存テーブル・既存行を削除せず、NULL許容カラムだけを追加する。

begin;

alter table public.recipe_ingredients
  add column if not exists calculation_type text,
  add column if not exists calculation_basis text;

alter table public.recipe_ingredients
  drop constraint if exists recipe_ingredients_calculation_type_check,
  add constraint recipe_ingredients_calculation_type_check
    check (calculation_type is null or calculation_type in ('fixed', 'percentage')),
  drop constraint if exists recipe_ingredients_calculation_basis_check,
  add constraint recipe_ingredients_calculation_basis_check
    check (calculation_basis is null or calculation_basis in (
      'meat',
      'meat_plus_water',
      'meat_plus_water_plus_emulsion',
      'fixed'
    ));

comment on column public.recipe_ingredients.calculation_type is
  'fixed: amount_gを使用、percentage: percentageとcalculation_basisを使用';
comment on column public.recipe_ingredients.calculation_basis is
  'percentageの基準。meat / meat_plus_water / meat_plus_water_plus_emulsion / fixed';

commit;
