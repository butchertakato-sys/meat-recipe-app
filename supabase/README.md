# Supabase DB構築仕様書 Ver.1

このフォルダにはDB構築SQLと、既存アプリへ接続したIndexedDB先行保存・Supabase同期モジュールが含まれます。

## 実行順

1. Supabaseで新規プロジェクトを作成する。
2. SQL Editorで`schema.sql`を実行する。
3. SQL Editorで`verify.sql`を実行し、10テーブル・制約・RLSを確認する。
4. この段階では`seed.sql`を実行せず、マスタを手入力しない。
5. Authenticationで最初のユーザーを作成する。
6. businessesとbusiness_membersへ事業者・ownerの関係を登録する。
7. ownerで所属事業者だけを参照でき、別ユーザーから参照できないことを確認する。
8. RLS確認後の次工程で`seed.sql`による初期マスタ投入を行う。

既に`schema.sql`を適用済みのDBでは、テーブルを作り直さず、`migration_002_recipe_ingredient_calculation.sql`、`migration_003_packaging_unit_range.sql`、`migration_004_recipe_calculation_structure.sql`の順に実行して必要なカラムを追加します。このリポジトリではSQLを作成・更新するだけで、Supabaseへの実行は行いません。

## 正式な関連付け

- 外部キーはすべてUUIDを使用する。
- `internal_code`と表示名は検索・確認用で、外部キーとして使わない。
- 商品名を変更してもproducts.idは変更しない。
- recipe/packagingは本体とversionを分離し、製造記録は製造時点のversionを保持する。
- 1仕込みはmanufacturing_recordsの1行とし、内訳はmanufacturing_allocationsへ複数行保存する。

## 保存の原子性

`save_manufacturing_record(record_data, allocation_data)` RPCは、ブラウザで生成した同一UUIDを使って製造記録と内訳を同一トランザクションでupsertします。同じUUIDを再送しても二重登録されず、allocationが1件でも制約違反ならrecord更新もrollbackされます。

## RLS

全10テーブルでRLSを有効にしています。`auth.uid()`からbusiness_membersを経由して、所属business_idの行だけを操作できます。ブラウザではanon/publishable keyとAuthセッションを使用し、service_role keyは使用しません。

## 初期データについて

`schema.sql`は初期データを一切登録しません。`seed.sql`は次工程用として分離してあり、Authユーザー、businesses、business_membersの関係とRLSを確認するまで実行しません。

`seed.sql`の正式商品コードは`ARABIKI`、`ADDITIVE_FREE_ARABIKI`、`HERB`、`CHEESE`、`CHORIZO`、`YAMAGOYA`、`GIBIER_CENTER`、`TOUGE`、`ZANZATEI`です。正式包装候補は10件で、通常3本包装（あらびき・無添加あらびき・ハーブ・チーズ・チョリソー）は40g/本・120g/パック、ハーブイベントは75g/本、ジビエセンターは65g/本です。山小屋の7～8本包装は`min_units_per_package`と`max_units_per_package`で保持します。包装仕様の適用開始日は未提示のため`effective_from`を`null`にしています。

## recipe計算情報

- `calculation_type`は`fixed`（固定重量）、`percentage`（割合計算）、`input`（製造時入力）を使用します。
- `percentage`には百分率値を保存します。20%は`20`、1.6%は`1.6`として保存し、計算時に`percentage / 100`を使用します。
- `calculation_basis`は`meat`、`meat_plus_water`、`meat_plus_water_plus_emulsion`、`meat_plus_back_fat`、`meat_plus_back_fat_plus_water`、`fixed`を使用します。
- `ingredient_role = meat_input`のinput材料を合計した値が`meat`基準です。
- `allow_manual_override = true`の材料は、通常計算値を製造時入力で上書きできます。
- `recipe_ingredients_version_code_unique`により、ingredient_codeがある材料は同じrecipe version内で重複登録されません。
- 無添加あらびきの96g、山小屋の334gはスパイスブレンド作成時の基準配合です。製造recipeへ直接加算せず、製造使用量を持つ`SPICE_BLEND`／`YAMAGOYA_SPICE`のnotesに保持します。

## DELETE権限

authenticatedには対象10テーブルのDELETE権限を付与していません。製造記録は`status = 'deleted'`、各マスタは`is_active = false`で管理します。recordとallocationを原子的に置換するRPC内部だけが、所属事業者を明示検証したうえで既存allocationを置換します。

## DB単体テスト項目

- products.internal_codeが同一事業者内で重複登録できない。
- recipe_versionsとpackaging_versionsのcurrentが各本体につき1件だけになる。
- quantity、重量、日付範囲の不正値がCHECK制約で拒否される。
- 過去versionを参照する製造記録がある状態でversionを削除できない。
- RPCでrecordとallocationが同時に保存・同時にrollbackされる。
- status=deletedの運用でも物理データが残る。
- RLSで別事業者のデータを読み書きできない。

## 現時点で保留するもの

- ログイン画面
- 既存データ変換・投入
- CSVのDB取得対応
- SupabaseからIndexedDBへの完全同期

## iPadローカル保存モジュール

- `offline-sync.js`は標準IndexedDB APIだけを使い、製造記録と内訳を同一トランザクションで端末へ先に保存します。
- `app-sync-adapter.js`は現行製造記録をSupabase/IndexedDB共通形式へ変換します。
- `supabase-config.example.js`は接続設定の雛形です。service_roleは設定しません。
- Supabase未設定・未ログイン・通信失敗時もIndexedDBの記録は削除されず、`error`として再同期対象に残ります。

## アプリ接続設定

1. `supabase-config.js`の`enabled`、`url`、`publishableKey`、`businessId`を設定する。
2. Authログイン処理から`getAccessToken`で現在のaccess tokenを返す。
3. `ids`へ各product/recipe/version/packagingのUUIDを設定する。
4. ブラウザへ置くのはpublishable keyだけとし、service_role keyは置かない。

接続値が未設定の初期状態でも端末保存は有効で、製造記録は再同期対象として保持されます。

## Supabase Authログイン

- `auth.js`はSupabase公式JavaScriptクライアントを1個だけ作成し、メールアドレス・パスワードによるログインを行います。
- セッションはSupabase公式クライアントの`persistSession`と`autoRefreshToken`で維持・更新します。パスワードをアプリ独自に保存しません。
- `supabase-config.js`の`getAccessToken`は、`auth.js`が管理する現在のセッションから`access_token`を返します。マスタ読み込みと製造記録同期は同じ関数を利用します。
- 接続設定済みで有効なセッションがない場合だけログイン画面を表示します。有効なセッションがあれば通常画面へ進みます。
- 通信障害やAuthライブラリ読込失敗の場合は、既存のローカルマスタ・IndexedDBを使ってアプリを起動します。
- 新規登録、パスワード変更、複数事業者切替、service_role keyの利用は実装していません。

## 正式マスタ読み込み

- `master-data.js`はアプリ起動時にproducts、recipes、current recipe_versions、そのrecipe_ingredients、packaging_master、current packaging_versionsをREST APIで取得します。
- 接続には既存の`MEAT_SUPABASE_CONFIG`を使用し、別のSupabase clientは作成しません。
- `businessId`は設定ファイルの1か所で管理します。ブラウザへ置くのは公開可能なpublishable/anon keyだけです。
- 取得件数がproducts 9件、recipes 8件、recipe_versions 8件、recipe_ingredients 52件、包装本体・version各10件と一致した場合だけ正式キャッシュとして採用します。
- 正常取得した生データは`meatRecipeApp.supabaseMasters.v1`へキャッシュし、正式internal_codeからUUIDを解決して既存同期アダプターの`ids`へ反映します。
- 包装マスタは既存画面形式へ変換して`packagingMaster.v1`へキャッシュします。新規作業ではSupabaseのcurrent versionが優先されます。
- Supabase未設定、未ログイン、通信失敗、件数不一致の場合は、直近の正式マスタキャッシュ、既存localStorage包装マスタの順でフォールバックします。
- 最新マスタの読み込みでは既存製造記録を再計算・更新しません。製造記録に保存済みのversion・単位重量・完成重量を維持します。
- Consoleには`[Supabaseマスタ]`で始まる接続結果と各テーブルの件数を出力します。

## 製造履歴ローカルキャッシュ

- 履歴画面はIndexedDBの記録を先に表示し、その後Supabaseのrecordとallocationをバックグラウンド取得します。
- Supabase取得結果は同じUUIDでupsertし、`pending`、`error`、`syncing`のローカル記録を上書きしません。
- 通信復帰時はローカル未同期送信を先に実行し、その成功確認後にクラウド履歴を取得します。
- `sync_meta`へ最終履歴同期日時・結果・エラーを保存します。
- `status = deleted`はIndexedDBに保持し、通常の履歴一覧では非表示にします。
