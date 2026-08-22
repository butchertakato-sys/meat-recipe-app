-- 食肉加工アプリ: recipe計算構造の拡張
-- 既存テーブル・既存行を削除せず、可変入力・背脂基準・手入力上書きを表現する。

begin;

alter table public.recipe_ingredients
  add column if not exists allow_manual_override boolean not null default false;

alter table public.recipe_ingredients
  drop constraint if exists recipe_ingredients_calculation_type_check,
  add constraint recipe_ingredients_calculation_type_check
    check (calculation_type is null or calculation_type in (
      'fixed',
      'percentage',
      'input'
    )),
  drop constraint if exists recipe_ingredients_calculation_basis_check,
  add constraint recipe_ingredients_calculation_basis_check
    check (calculation_basis is null or calculation_basis in (
      'meat',
      'meat_plus_water',
      'meat_plus_water_plus_emulsion',
      'meat_plus_back_fat',
      'meat_plus_back_fat_plus_water',
      'fixed'
    ));

create unique index if not exists recipe_ingredients_version_code_unique
  on public.recipe_ingredients(recipe_version_id, ingredient_code)
  where ingredient_code is not null;

comment on column public.recipe_ingredients.calculation_type is
  'fixed: 固定重量、percentage: percentage/100で割合計算、input: 製造時入力';
comment on column public.recipe_ingredients.calculation_basis is
  'percentage計算の基準。inputではNULLを使用可能';
comment on column public.recipe_ingredients.allow_manual_override is
  'trueの場合、通常計算値を製造時の手入力値で上書き可能';
comment on column public.recipe_ingredients.percentage is
  '百分率値を保存する。例: 20%=20、1.6%=1.6。計算時は100で割る';

commit;
