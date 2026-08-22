-- 初期IDは移行対応表で再利用できるよう固定する。
begin;

insert into public.businesses (id, name) values
  ('10000000-0000-4000-8000-000000000001', 'BUTCHER TAKATO')
on conflict (id) do nothing;

insert into public.products (id, business_id, internal_code, display_name, product_category, manufacturing_type, sort_order) values
  ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','ARABIKI','あらびき','sausage','own',10),
  ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','CHEESE','チーズ','sausage','own',20),
  ('20000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','HERB','ハーブ','sausage','own',30),
  ('20000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','CHORIZO','チョリソー','sausage','own',40),
  ('20000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000001','ADDITIVE_FREE_ARABIKI','無添加あらびき','sausage','own',50),
  ('20000000-0000-4000-8000-000000000006','10000000-0000-4000-8000-000000000001','YAMAGOYA','山小屋','sausage','contract',60),
  ('20000000-0000-4000-8000-000000000007','10000000-0000-4000-8000-000000000001','GIBIER_CENTER','ジビエセンター鹿ソーセージ','sausage','contract',70),
  ('20000000-0000-4000-8000-000000000008','10000000-0000-4000-8000-000000000001','TOUGE','峠の茶屋','sausage','contract',80),
  ('20000000-0000-4000-8000-000000000009','10000000-0000-4000-8000-000000000001','ZANZATEI','ざんざ亭鹿ソーセージ','sausage','contract',90)
on conflict (business_id, internal_code) do nothing;

-- 正式recipe。峠の茶屋は振分先のため独立recipeを作成しない。
with recipe_source (internal_code, display_name, recipe_type, product_code) as (
  values
    ('ARABIKI','あらびき','variable','ARABIKI'),
    ('ADDITIVE_FREE_ARABIKI','無添加あらびき','fixed','ADDITIVE_FREE_ARABIKI'),
    ('HERB','ハーブ','variable','HERB'),
    ('CHEESE','チーズ','variable','CHEESE'),
    ('CHORIZO','チョリソー','variable','CHORIZO'),
    ('YAMAGOYA','山小屋','variable','YAMAGOYA'),
    ('GIBIER_CENTER','ジビエセンター鹿ソーセージ','variable','GIBIER_CENTER'),
    ('ZANZATEI','ざんざ亭鹿ソーセージ','supplied_dough','ZANZATEI')
)
insert into public.recipes (business_id, product_id, internal_code, display_name, recipe_type, is_active)
select '10000000-0000-4000-8000-000000000001', p.id,
       source.internal_code, source.display_name, source.recipe_type, true
from recipe_source source
join public.products p
  on p.business_id = '10000000-0000-4000-8000-000000000001'
 and p.internal_code = source.product_code
on conflict (business_id, internal_code) do nothing;

-- 初期正式recipe version。可変recipeの固定重量は推測せずNULLとする。
with version_source (
  recipe_code, theoretical_weight_g, base_meat_weight_g, water_weight_g,
  emulsion_weight_g, casing, length_cm, notes
) as (
  values
    ('ARABIKI',null::numeric,null::numeric,null::numeric,null::numeric,null::text,null::numeric,'肉重量は製造時入力。乳化生地は通常自動計算、手入力上書き可。'),
    ('ADDITIVE_FREE_ARABIKI',4423.6,3600,null,null,'羊腸20-22',12,'氷720gを含む固定配合。スパイス30.2gのみ製造重量へ加算し、基準配合96gは加算しない。'),
    ('HERB',null,null,null,null,null,null,'肉重量は製造時入力。乳化生地は通常自動計算、手入力上書き可。包装区分はrecipeに含めない。'),
    ('CHEESE',null,null,null,null,null,null,'肉重量は製造時入力。乳化生地は通常自動計算、手入力上書き可。'),
    ('CHORIZO',null,null,null,null,null,null,'肉重量は製造時入力。乳化生地は通常自動計算、手入力上書き可。'),
    ('YAMAGOYA',null,null,null,null,'羊腸22-24',17,'肉重量は製造時入力。スパイス1.6%のみ製造重量へ加算し、基準配合334gは加算しない。'),
    ('GIBIER_CENTER',null,null,null,null,'羊腸24-26',15,'鹿肉と豚ひき肉は別々の製造時入力で、固定比率ではない。'),
    ('ZANZATEI',null,null,null,null,'羊腸22-24（支給）',13.5,'支給生地。配合計算は行わず、生地重量は製造記録側で入力する。')
)
insert into public.recipe_versions (
  recipe_id, version_no, effective_from, effective_to,
  theoretical_weight_g, base_meat_weight_g, water_weight_g, emulsion_weight_g,
  casing, length_cm, notes, is_current
)
select r.id, 1, null, null,
       source.theoretical_weight_g, source.base_meat_weight_g,
       source.water_weight_g, source.emulsion_weight_g,
       source.casing, source.length_cm, source.notes, true
from version_source source
join public.recipes r
  on r.business_id = '10000000-0000-4000-8000-000000000001'
 and r.internal_code = source.recipe_code
on conflict (recipe_id, version_no) do nothing;

-- percentageは百分率値を保存する（20%=20、1.6%=1.6）。計算時に100で割る。
with ingredient_source (
  recipe_code, ingredient_code, ingredient_name, amount_g, percentage,
  calculation_type, calculation_basis, allow_manual_override,
  ingredient_role, sort_order, notes
) as (
  values
    ('ARABIKI','MEAT_INPUT','肉重量',null::numeric,null::numeric,'input',null::text,false,'meat_input',10,null::text),
    ('ARABIKI','WATER','水',null,20,'percentage','meat',false,'water',20,null),
    ('ARABIKI','EMULSION','乳化生地',null,20,'percentage','meat_plus_water',true,'emulsion',30,'通常は自動計算。製造時に手入力値で上書き可能。'),
    ('ARABIKI','SALT','塩',null,1.6,'percentage','meat_plus_water',false,'seasoning',40,null),
    ('ARABIKI','WIENER_HELAMANT','ウインナーヘラマント',null,0.5,'percentage','meat_plus_water_plus_emulsion',false,'seasoning',50,null),
    ('ARABIKI','HERABIN_E','ヘラビンE',null,0.3,'percentage','meat_plus_water',false,'seasoning',60,null),
    ('ARABIKI','PELVINAL_HH','ペルビナールHH',null,0.1,'percentage','meat_plus_water',false,'seasoning',70,null),

    ('ADDITIVE_FREE_ARABIKI','MEAT_6MM','6mm肉',1800,null,'fixed','fixed',false,'other',10,null),
    ('ADDITIVE_FREE_ARABIKI','LEAN_MEAT_3MM','3mm肉（赤身）',1800,null,'fixed','fixed',false,'other',20,null),
    ('ADDITIVE_FREE_ARABIKI','ICE','氷',720,null,'fixed','fixed',false,'water',30,null),
    ('ADDITIVE_FREE_ARABIKI','SALT','塩',73.4,null,'fixed','fixed',false,'seasoning',40,null),
    ('ADDITIVE_FREE_ARABIKI','SPICE_BLEND','スパイス',30.2,null,'fixed','fixed',false,'spice_blend',50,'製造recipeへ加算する重量は30.2g。基準配合96g：ホワイトペッパー27g、パプリカパウダー17g、コリアンダー11g、ナツメグ9g、マスタードパウダー7g、三温糖25g。96gは製造重量へ直接加算せず、30.2gへ比例換算しない。'),

    ('HERB','MEAT_INPUT','肉重量',null,null,'input',null,false,'meat_input',10,null),
    ('HERB','WATER','水',null,20,'percentage','meat',false,'water',20,null),
    ('HERB','EMULSION','乳化生地',null,20,'percentage','meat_plus_water',true,'emulsion',30,'通常は自動計算。製造時に手入力値で上書き可能。'),
    ('HERB','SALT','塩',null,1.6,'percentage','meat_plus_water',false,'seasoning',40,null),
    ('HERB','BRATWURST_D','ブラートブルストD',null,0.5,'percentage','meat_plus_water_plus_emulsion',false,'seasoning',50,null),
    ('HERB','HERABIN_E','ヘラビンE',null,0.3,'percentage','meat_plus_water',false,'seasoning',60,null),
    ('HERB','PELVINAL_HH','ペルビナールHH',null,0.1,'percentage','meat_plus_water',false,'seasoning',70,null),
    ('HERB','MARJORAM','マジョラム',null,0.1,'percentage','meat_plus_water_plus_emulsion',false,'seasoning',80,null),
    ('HERB','BASIL','バジル',null,0.05,'percentage','meat_plus_water_plus_emulsion',false,'seasoning',90,null),
    ('HERB','OREGANO','オレガノ',null,0.05,'percentage','meat_plus_water_plus_emulsion',false,'seasoning',100,null),

    ('CHEESE','MEAT_INPUT','肉重量',null,null,'input',null,false,'meat_input',10,null),
    ('CHEESE','WATER','水',null,20,'percentage','meat',false,'water',20,null),
    ('CHEESE','EMULSION','乳化生地',null,20,'percentage','meat_plus_water',true,'emulsion',30,'通常は自動計算。製造時に手入力値で上書き可能。'),
    ('CHEESE','SALT','塩',null,1.6,'percentage','meat_plus_water',false,'seasoning',40,null),
    ('CHEESE','WIENER_HELAMANT','ウインナーヘラマント',null,0.5,'percentage','meat_plus_water_plus_emulsion',false,'seasoning',50,null),
    ('CHEESE','HERABIN_E','ヘラビンE',null,0.3,'percentage','meat_plus_water',false,'seasoning',60,null),
    ('CHEESE','PELVINAL_HH','ペルビナールHH',null,0.1,'percentage','meat_plus_water',false,'seasoning',70,null),
    ('CHEESE','CHEESE','チーズ',null,10,'percentage','meat_plus_water_plus_emulsion',false,'cheese',80,null),

    ('CHORIZO','MEAT_INPUT','肉重量',null,null,'input',null,false,'meat_input',10,null),
    ('CHORIZO','WATER','水',null,20,'percentage','meat',false,'water',20,null),
    ('CHORIZO','EMULSION','乳化生地',null,20,'percentage','meat_plus_water',true,'emulsion',30,'通常は自動計算。製造時に手入力値で上書き可能。'),
    ('CHORIZO','SALT','塩',null,1.6,'percentage','meat_plus_water',false,'seasoning',40,null),
    ('CHORIZO','HERABIN_E','ヘラビンE',null,0.3,'percentage','meat_plus_water',false,'seasoning',50,null),
    ('CHORIZO','PELVINAL_HH','ペルビナールHH',null,0.1,'percentage','meat_plus_water',false,'seasoning',60,null),
    ('CHORIZO','CHORIZO_SPICE','チョリソースパイス',null,1.2,'percentage','meat_plus_water_plus_emulsion',false,'seasoning',70,null),
    ('CHORIZO','CHILI_PEPPER','唐辛子',null,0.2,'percentage','meat_plus_water_plus_emulsion',false,'seasoning',80,null),

    ('YAMAGOYA','MEAT_INPUT','肉重量',null,null,'input',null,false,'meat_input',10,null),
    ('YAMAGOYA','BACK_FAT','背脂',null,16,'percentage','meat',false,'back_fat',20,null),
    ('YAMAGOYA','WATER','水',null,20,'percentage','meat_plus_back_fat',false,'water',30,null),
    ('YAMAGOYA','SALT','塩',null,1.6,'percentage','meat_plus_back_fat_plus_water',false,'seasoning',40,null),
    ('YAMAGOYA','YAMAGOYA_SPICE','スパイス',null,1.6,'percentage','meat_plus_back_fat_plus_water',false,'spice_blend',50,'製造時は基準重量の1.6%のみ加算。基準配合334g：ホワイトペッパー132g、コリアンダー80g、クローブ20g、クミン20g、ナツメグ6g、ガーリック6g、シナモン4g、ブドウ糖66g。334gは製造重量へ直接加算しない。'),
    ('YAMAGOYA','HERABIN_E','ヘラビンE',null,0.3,'percentage','meat_plus_back_fat_plus_water',false,'seasoning',60,null),
    ('YAMAGOYA','PELVINAL_HH','ペルビナールHH',null,0.1,'percentage','meat_plus_back_fat_plus_water',false,'seasoning',70,null),

    ('GIBIER_CENTER','DEER_MEAT_INPUT','鹿肉重量',null,null,'input',null,false,'meat_input',10,'製造時入力。画面初期値7000gを固定値として保存しない。'),
    ('GIBIER_CENTER','PORK_MEAT_INPUT','豚ひき肉重量',null,null,'input',null,false,'meat_input',20,'製造時入力。画面初期値3000gを固定値として保存しない。'),
    ('GIBIER_CENTER','WATER','水',null,20,'percentage','meat',false,'water',30,null),
    ('GIBIER_CENTER','SALT','塩',null,1.6,'percentage','meat_plus_water',false,'seasoning',40,null),
    ('GIBIER_CENTER','WIENER_HELAMANT','ウインナーヘラマント',null,0.5,'percentage','meat_plus_water',false,'seasoning',50,null),
    ('GIBIER_CENTER','HERABIN_E','ヘラビンE',null,0.3,'percentage','meat_plus_water',false,'seasoning',60,null),
    ('GIBIER_CENTER','PELVINAL_HH','ペルビナールHH',null,0.1,'percentage','meat_plus_water',false,'seasoning',70,null)
)
insert into public.recipe_ingredients (
  recipe_version_id, ingredient_code, ingredient_name, amount_g, percentage,
  calculation_type, calculation_basis, allow_manual_override,
  ingredient_role, sort_order, notes
)
select
  rv.id, source.ingredient_code, source.ingredient_name,
  source.amount_g, source.percentage, source.calculation_type,
  source.calculation_basis, source.allow_manual_override,
  source.ingredient_role, source.sort_order, source.notes
from ingredient_source source
join public.recipes r
  on r.business_id = '10000000-0000-4000-8000-000000000001'
 and r.internal_code = source.recipe_code
join public.recipe_versions rv
  on rv.recipe_id = r.id
 and rv.version_no = 1
on conflict (recipe_version_id, ingredient_code)
  where ingredient_code is not null
do nothing;

-- 値が設計書で確定している包装だけを投入する。未確定値は独断で補完しない。
insert into public.packaging_master (id, business_id, product_id, internal_code, display_name, allocation_type) values
  ('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000003','HERB_STANDARD','ハーブ製品用包装','HERB_STANDARD'),
  ('30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000003','HERB_EVENT','ハーブイベント用','HERB_EVENT'),
  ('30000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000008','TOUGE_STANDARD','峠の茶屋用','TOUGE'),
  ('30000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','ARABIKI_STANDARD','あらびき通常包装','STANDARD'),
  ('30000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','CHEESE_STANDARD','チーズ通常包装','STANDARD'),
  ('30000000-0000-4000-8000-000000000006','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000004','CHORIZO_STANDARD','チョリソー通常包装','STANDARD'),
  ('30000000-0000-4000-8000-000000000007','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000007','GIBIER_CENTER_STANDARD','ジビエセンター通常包装','GIBIER_CENTER_STANDARD'),
  ('30000000-0000-4000-8000-000000000008','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000005','ADDITIVE_FREE_ARABIKI_STANDARD','無添加あらびき通常包装','STANDARD'),
  ('30000000-0000-4000-8000-000000000009','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000006','YAMAGOYA_STANDARD','山小屋通常包装','STANDARD'),
  ('30000000-0000-4000-8000-000000000010','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000009','ZANZATEI_STANDARD','ざんざ亭通常包装','STANDARD')
on conflict (business_id, internal_code) do nothing;

insert into public.packaging_versions (
  id, packaging_master_id, version_no, effective_from, unit_type,
  units_per_package, min_units_per_package, max_units_per_package,
  unit_weight_g, package_weight_g, bag_spec, casing, length_cm, is_current
) values
  ('40000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',1,null,'package',3,null,null,40,120,null,null,null,true),
  ('40000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000002',1,null,'piece',1,null,null,75,75,null,null,null,true),
  ('40000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000003',1,null,'package',2,null,null,35,70,null,null,null,true),
  ('40000000-0000-4000-8000-000000000004','30000000-0000-4000-8000-000000000004',1,null,'package',3,null,null,40,120,null,null,null,true),
  ('40000000-0000-4000-8000-000000000005','30000000-0000-4000-8000-000000000005',1,null,'package',3,null,null,40,120,null,null,null,true),
  ('40000000-0000-4000-8000-000000000006','30000000-0000-4000-8000-000000000006',1,null,'package',3,null,null,40,120,null,null,null,true),
  ('40000000-0000-4000-8000-000000000007','30000000-0000-4000-8000-000000000007',1,null,'piece',1,null,null,65,65,null,null,null,true),
  ('40000000-0000-4000-8000-000000000008','30000000-0000-4000-8000-000000000008',1,null,'package',3,null,null,40,120,'15-25','羊腸20-22',12,true),
  ('40000000-0000-4000-8000-000000000009','30000000-0000-4000-8000-000000000009',1,null,'package',null,7,8,65,null,'22-33','羊腸22-24',17,true),
  ('40000000-0000-4000-8000-000000000010','30000000-0000-4000-8000-000000000010',1,null,'package',5,null,null,50,250,'15-25（支給）','羊腸22-24（支給）',13.5,true)
on conflict (packaging_master_id, version_no) do nothing;

commit;

-- Authユーザー作成後、SQL Editorで実ユーザーUUIDへ置換して一度だけ実行する。
-- insert into public.business_members (business_id, user_id, role)
-- values ('10000000-0000-4000-8000-000000000001', '<AUTH_USER_UUID>', 'owner');
