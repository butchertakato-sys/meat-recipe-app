# 製造履歴：重複・削除復活・再描画の診断

監査基準：`main / 2c5fa57a9b6a90a05ded508e34c71e6f70e29406`。
以下の既存コード参照行は基準コミットの行番号。検証日は2026-10-09。
本番Supabaseへの書き込み・レコード削除・マスタ変更・LOT変更は行っていない。
本番認証セッションは実端末にあり、対象の実データはこの作業環境から取得していない。
mockの再現結果と実際に対象2LOTで起きた出来事を区別する。

## 1. 履歴表示が後から変わる原因【コード上確定】

`index.html:3035 showManufacturingRecordHistory` はlocalStorageを読み、即時描画する。
続けて `refreshManufacturingHistory(false)` を開始する。
同関数（2982）はまず `runCrossDeviceIntegration()` を実行し、IndexedDB取得後に再描画、
クラウド取得後に再描画する。失敗時にも別の描画経路がある。
`combinedManufacturingHistory`（1246）はcanonical統合後、`date DESC / updatedAt DESC` で並べ替える。
初回は `loadManufacturingRecords()` の保存順であり、後続描画とは取得層・統合・順序が異なる。
また履歴を開く操作は、現在の実装ではmigration/recoveryの再送信も起動する。

方針候補は、統合・取得の最終結果を確定させてから一覧を1回描画し、取得失敗時の表示も確定結果として扱うこと。
今回は描画経路を変更していない。

## 2. 2026/07/28の2記録【実端末データ待ち】

| 項目 | 20260728-IT-GIBIER-01 | 20260728-IT-GIBIER-02 |
|---|---|---|
| record ID / cloudRecordId | 未取得 | 未取得 |
| created_at / createdAt / savedAt | 未取得 | 未取得 |
| savedRecipeId | 未取得 | 未取得 |
| 燻製 / 燻製なし | 82 / 80（提示画像） | 82 / 80（提示画像） |
| savedUnitWeightG / allocation.unit_weight_g | 生値は未取得 | 生値は未取得 |
| 単位重量の算術上の対応 | 65g × 162 = 10,530g | 70g × 162 = 11,340g |
| 完成重量 | 10.53kg（提示画像） | 11.34kg（提示画像） |
| 歩留まり | 85.6%（提示画像） | 92.2%（提示画像） |

65g/70gとの一致は確認できるが、保存経路・保存時マスタ・実際のsnapshot値は未確認。
両者のsavedRecipeId一致、作成時刻差、同じ端末由来、-01が保存済みの時点で-02を保存したか、
LOT予約による変更、migrationでのID発行はまだ判定できない。

診断結果の `timelines` は層ごとの原時刻と差分秒を表示する。
`targetRecords` の `raw / fields / legacyPayload / legacyMeta / allocations` を比較する。
同じsavedRecipeIdは同じ保存レシピの参照を示すが、同じ操作・同じ端末の証明ではない。
製造記録のLEGACY_METAはsourceDeviceIdを明示保存していない。
保存済みレシピのsource_device_id/sourceDeviceIdと、端末に既存のdeviceIdがあれば併せて観測する。
作成時刻はクライアントから送信され、migrationでも過去createdAt/savedAtを使用する。
allocationのUUID/created_atはadapterを通るたび再発行されるため、原保存時刻とは限らない。
RPC upsertは既存recordのcreated_atを更新せず、DBのupdated_atにはnow()を設定するtriggerもある。
時刻差だけで「別々のクリック」を確定しない。

## 3. 全作成経路とUUID【コード監査済み】

| 経路 | 製造record IDの扱い | 根拠 |
|---|---|---|
| collectManufacturingRecord | IDを発行しない。数量・重量snapshot・LOTを収集 | index.html:2734 |
| recordSaveButton click | isSavingRecordをawait前に設定。新規UUIDを1個発行 | index.html:2688,2712 |
| saveManufacturingRecordOfflineFirst | adapterのIDをlegacyRecordPatchで元recordへ反映。通常保存ではLOT予約も行う | index.html:1107 |
| adapter.fromLegacy | cloudRecordId優先 → UUID形式のid → 新しいUUID | supabase/app-sync-adapter.js:225 |
| saveAndSync → putBundle | idが無いときだけ新規UUID。それ以外は同じidで保存 | supabase/offline-sync.js:74,394 |
| syncBundle / directUpsertBundle | 同一IDでRPC/upsert。製造recordの新規UUID発行なし | supabase/offline-sync.js:200,373 |
| runCrossDeviceIntegration → migrateManufacturingRecords | active cloudをLOTで照合。リンクが無い場合はuploadLocal→adapter。旧非UUID IDは変換可能 | index.html:1296 / supabase/cross-device-sync.js:348 |
| prepareManufacturingRecovery | old.record.idをcloudRecordIdとして固定し、old.record.statusを引き継ぐ | index.html:1205,1230 |
| reserveManufacturingLot | recordIdを受け取りLOT文字列を返す。製造recordのUUID発行なし | supabase/cross-device-sync.js:270 |
| generateManufacturingLot | 表示対象local履歴の件数＋1でLOTを作る。UUID発行なし | index.html:2263 |
| loadManufacturingRecords | IDの無い旧recordに時刻＋indexの文字列IDを付ける。UUID発行ではない | index.html:2874 |

**1回のクリックで2件生成されるコード経路なし（通常の保存ハンドラ単独）。**
同じ保存フォームから後でもう一度保存すると、再び新規UUIDを発行する。
共通のsavedRecipeId/保存レシピLOTに対する既存製造記録の更新を選ぶ処理はない。
したがって別々の保存で別LOTを作ることは可能だが、対象2LOTがそう作られたとはまだ判定できない。
migration/recoveryが独立に動く状況、特に削除時LOT変更＋旧archiveの再取込みでは別UUIDも作成可能（下記mock再現）。

新規UUID発行箇所の全検索結果：

- `index.html:2712`：通常製造保存。Sync APIがない場合 `createRecordId("manufacturing-record")`（2182）でprefix付きIDを発行し、後のadapterで正式UUIDに変換できる。
- `supabase/app-sync-adapter.js:225`：上表の正式record ID変換。
- `supabase/offline-sync.js:74`：putBundleのrecord.id欠落時。uuid実装は16〜24。
- `supabase/app-sync-adapter.js:109`：各allocation。LEGACY_METAを含む。
- `supabase/offline-sync.js:84`：allocation.id欠落時。
- `supabase/cross-device-sync.js:28`：端末ID。113,213：保存済みレシピcloud ID。uuid実装は14〜22。製造recordではない。
- `index.html:1807,2182,2190`：カスタム包装ID・保存済みレシピID。製造recordではない。
- `supabase/schema.sql` の `gen_random_uuid()` defaults：businesses(12)、business_members(20)、products(29)、recipes(43)、recipe_versions(56)、recipe_ingredients(78)、packaging_master(97)、packaging_versions(110)、manufacturing_records(136)、manufacturing_allocations(158)。通常の製造RPC/RESTはidを明示送信するのでdefaultで別IDを作らない。
- `supabase/cross_device_sync_migration.sql:9,56`：保存済みレシピ行・LOT予約行のdefault UUID。予約行のidは製造record_idとは別物。

## 4. 削除復活【mockで経路確定、実機の該当経路は未確定】

削除（index.html:3384）は `loadManufacturingRecords()` 内からidを探し、
status=deleted/updatedAtを設定し、通常のoffline-first保存へ渡す。
adapter（225〜260）はcloudRecordIdまたはUUID idを使い、正式status=deletedを送る。
RPCでも直接RESTでも成功すれば同IDのcloud rowがdeletedになる。
既存UUID/cloudRecordIdがある場合は層間のIDを維持するが、旧非UUIDでcloudRecordId欠落なら新IDになる。
**実端末の削除対象IDが3層で一致しているかは未取得。**
また削除対象がlocalStorageになくIndexedDBのみにある場合は、現在のdelete関数は「見つかりません」で失敗する。

delete関数は保存結果の `synced` を調べない。
`synced:false / localSaved:true` でもlocalへdeletedを保存して「削除しました」と表示する。
`cacheCloudHistory`（offline-sync.js:308）は同IDのpending/error/syncingをcloudで上書きしない。
syncedのrecordはcloud更新時刻が同じか新しい場合に受け入れるため、条件が合えばactiveで上書きできる。
「削除送信失敗→単純なcloud pull」で必ず復活するわけではない。

### CASE A〜Eの現行コード結果

| CASE | 再現条件 | 結果 |
|---|---|---|
| A | 同IDでlocal/IndexedDB/cloud activeを削除、送信成功、再同期 | 3層deleted。表示されない |
| B | 送信失敗→local/IndexedDB deleted/error、cloud active→pull | 同IDerrorの保護によりIndexedDB deleted維持。archiveなしでは非表示。ただしUIは「削除しました」。送信再試行の成功でcloud deleted |
| C | 同LOT別IDの2件の片方を削除 | 他IDはcloud activeのまま。local deletedが最新のhealthyなら当初はLOT統合で両方隠れる。後続local保存でtombstoneが消えると残ったactiveが表示される |
| D | archive active＋local deleted/error＋IndexedDB deleted/synced＋cloud deleted | deletedを含めたcanonicalではdeleted。archiveのactiveは優先されない |
| E | DのIndexedDB deletedをloadIndexedManufacturingHistoryで除外 | explicit activeのarchiveがlocal deleted/errorに勝ち、表示側canonicalはactive。local deletedが最新のhealthy/syncedなら非表示。後続保存でlocal tombstoneが消えればarchive activeが表示される。完全なcloud tombstoneがrecoverRecordに渡れば、このfixtureではcloud再活性化を防ぐ |

CASE Cは依頼された不整合状態をmockに投入した検証。
`manufacturing_records_business_lot_active_unique` が本番に適用済みなら、同business・同LOTのactive 2行の新規作成は制約で禁止される。
本番にその状態が存在するとは主張しない。異なるLOTの-01/-02はこの制約に抵触しない。

CASE Eの根拠：`loadIndexedManufacturingHistory`（1235）がdeletedをMap/返却配列に入れない。
canonical（history-recovery.js:71）は通常archive→local→cloud→indexedのフィールド順で統合し、
healthy/syncedの最新候補と、indexed/cloudの同期候補を別途扱う。
localのみのdeletedを無条件に優先する規則はない。
`loadManufacturingRecords`（2937）はdeletedを除外するため、後続の新規保存・編集保存で
その返却値を `saveManufacturingRecords` に渡すとcurrent localStorageのtombstoneも失われる。

### 実際にactiveを再送信してしまう経路の追加再現

1. cloud/local/IndexedDBに同じUUIDのactiveがある。
2. 旧archiveにも同LOTのexplicit activeがあり、cloud側にないrecipeRowsを持つ。
3. 削除送信失敗→IndexedDBはdeleted/error、cloudはactiveのまま。
4. `runCrossDeviceIntegration` は `canonicalManufacturingHistory(await loadIndexedManufacturingHistory())` を使う。
5. IndexedDBのdeletedが除外され、archive activeが表示・migration入力へ復帰する。
6. `recoverRecord` が残存cloud activeと統合。archiveの補完recipeRowsが `shouldRepublishRecovery` に該当する。
7. `migrateManufacturingRecords` が `uploadLocal(...migration/recovery...)` を呼ぶ。
8. adapter→putBundle→saveAndSyncが**同UUIDのactive**を保存・再送信し、IndexedDB/cloudがactiveになる。
9. この処理は後段のsyncPendingより先なので、本来のdeleted/errorが上書きされ、削除再試行対象も失われる。

このfixtureで同UUIDのIndexedDB/cloud active復帰を実ブラウザmockで確認した。
実際の復活記録がこの条件を満たすかは `identities/deletedRecords/canonicalObservation` と実データで照合する。

### 削除時LOT予約→別UUID再生成の追加再現

`saveManufacturingRecordOfflineFirst` は削除・編集にも通常保存用のLOT予約を呼ぶ。
SQL reserve RPC（cross_device_sync_migration.sql:70）は有効な同record予約を探すが、
既存manufacturing_recordsの同record IDのLOTを返す処理はない。
予約は30分で期限切れとなり、expired予約の除去後にactive/reservedの最大番号＋1を返す。
したがって既存-01の削除で-02へ変わることがある。
SQLのこの条件を模したRPC応答で、現行JSがdeleted recordのLOTを-02に変更することを確認した。

LEGACY_METAは予約**前**に作成され、LOT変更後にnotesが更新されないため、
正式LOT=-02／LEGACY_META.lot=-01の不一致も再現した。
cloudRecordId未リンクの旧非UUID archive -01が残ると、削除済み-02と別グループになり、
migrationが-01を**新UUIDのactive**として作成できる。
通常の単発削除成功とは別の、旧archive・LOT変更・ID未リンクが揃う経路である。
期限切れ予約はRPC自身が消すため、今回の読取だけで過去の予約呼出履歴を必ず復元できるわけではない。

## 5. 65g/70gの優先順位・影響範囲【コード監査済み】

- 正式65g：`supabase/seed.sql:183` のGIBIER_CENTER_STANDARD version、unit_weight_g/package_weight_g両方65。
- ローカル70g：`index.html:1572 initialPackagingMasterRecords` のジビエ通常unitWeightG/netWeightG。
- fallback70g：`index.html:926 calculateGibierProductionMetrics` の省略時引数。
- seedのGIBIER_CENTER product行末尾70（15）はdisplay_orderで、単位重量ではない。
- 他商品の65/70、CSSの70等はジビエの単位重量定義ではない。productionコード全検索で確認。

新規数量計算は `packagingMaster.v1` の使用中包装のunitWeightGを読む。
Supabase master-dataはcurrent versionを取得し、`applySupabaseMasterData`（1047）がローカル包装マスタを置き換える。
cloud取得失敗時にはcached Supabase masterが利用され、既存包装masterが残る。
包装masterが未作成ならローカル初期70gが作成される。
したがって**cloud current masterが適用済みならその値が優先、未適用時は端末の包装masterの値**。
seedが65でも実際のDB current versionが65とは未確認。診断でcurrent/過去versionの生値を取得する。

注意点：`recordSaveButton` は `collectManufacturingRecord` で数量・重量snapshotを先に確定し、
その後のoffline-first保存でmaster refreshを行う。
refresh後にrecordの重量を再計算しないため、計算時70gのrecordが、65g current version IDと一緒に送られることもコード上可能。
このため「保存時にmaster refreshしたから必ず65g」ではない。

保存snapshot：localのsavedUnitWeightG/unitWeight/packWeight、actualFinishedWeightG/finishedWeight、
actualYieldPercent/yieldRate、LEGACY_META、allocation.unit_weight_g/calculated_weight_g、正式完成重量・歩留まり。
adapterはsnapshot重量を優先し、正数がない場合だけcurrent versionから補う。
quantity変更なしの編集は保存済み完成重量・歩留まりを保持し、数量変更時も保存単位重量を使う。
analysisは保存済みactualFinishedWeightG/finishedWeightを読み、masterで再計算しない。

ただし過去値の不変性を全recordに保証することはできない：

- `loadManufacturingRecords`（2907）は完成重量欠落時、保存unit weightを引数に渡さずfallback70gでジビエ重量を復元する。
- recovery（2245）はsavedUnitWeightG欠落時に現在の包装specを補う。
- `history-recovery.fromBundle` はSTANDARD allocationのunit weightは取り出すが、GIBIER allocationのunit weightをsavedUnitWeightGへ明示復元しない。LEGACY_META欠落時のsnapshot復元には注意が必要。
- canonicalは層別にフィールド統合するため、欠落・不整合がある過去recordは別層の値で補完される。

完全なsnapshotがある通常recordは単なるmaster変更で再計算されない。
欠落snapshot、復旧、保存前後のmaster適用タイミングは影響範囲に含む。

## 6. 修正対象候補／今回の変更

原因照合後の修正候補：

| ファイル | 対象 |
|---|---|
| index.html | 初回/後続描画、deleted除外、local tombstone保持、削除同期結果、保存前master確定、fallback重量、削除/編集時LOT予約 |
| supabase/history-recovery.js | tombstoneの優先・同LOT別ID統合、ジビエallocation snapshot復元 |
| supabase/cross-device-sync.js | deleted保護、migrationのactive再送信防止、同savedRecipeId/LOT/ID照合 |
| supabase/app-sync-adapter.js | 旧IDとcloud identityの確実な継承、重量snapshotとversion照合、LOT変更時meta整合 |
| supabase/offline-sync.js | キャッシュ・同期時のtombstone保護（現行error保護は既に存在） |
| supabase/cross_device_sync_migration.sql | 既存recordのLOT再利用、deleted→activeの再送信ガードが必要か検討 |
| supabase/seed.sql | 正式65gの確認対象。今回も値変更なし |

今回の変更は読み取り専用 `supabase/record-observation.js`、そのscript読み込み・製造記録メニューの入口、
テスト・診断報告・npm test対象だけ。保存・削除・計算・同期・描画ロジックの修正はしていない。

診断はアプリのloader/initializer/recoveryラッパーを呼ばない。
IndexedDBは既存DBを列挙後にreadonly transactionで読む。DBが無ければ作らず、unexpected upgradeはabortする。
Supabaseは同businessのrecord/allocation/保存レシピをID順のページで最後までGETし、対象日＋商品／対象LOT／deletedを観測する。
RLS・HTTP失敗・ページ欠落はerror/partialとして記録し、空配列を「存在しない証拠」と扱わない。
LOT予約テーブルはread権限が通常revokeされているため、403等の取得不可を記録する。予約RPCは呼ばない。
認証は既存のdefault Supabase SDK保存sessionのaccess_tokenをGET headerにのみ使い、Auth refreshも起動しない。
認証tokenやrefresh_tokenは診断出力に含めない。
localStorage/IndexedDBの読取前後差を記録する。独立した既存background syncは変更していないので、跨層snapshotは原子的ではない。
同じLOTの別IDを診断前に統合せず、生recordは別々に残す。
結果は独立したdialogに表示するため、既に動いている履歴再描画が結果やコピーボタンを消さない。
pure recoveryによる「deletedを含む」「現行表示経路のdeleted除外」「cloudを含む」の比較を別枠に表示する。

## 7. 修正方針／次の判断

実データのIDs・snapshot・時刻・LOT/meta差分と、上の再現条件を照合して修正範囲を決める。
推測で2件を同一保存と断定しない。created_atやLOT順だけでも断定しない。
保存操作のイベントログが残っていなければ、診断結果取得後もクリック由来の一意判定ができないことは明記する。

確認後の方針候補は、最終履歴1回描画、統合前tombstone除外の廃止と保持、migrationが削除の印を上書きしないこと、
同期成功と端末削除を区別する表示、削除・編集の既存ID/LOT保持、正規65gの一元化と過去snapshot保持。
同savedRecipeIdの別recordを統合するかは業務上の複数製造の扱いも含めて判断し、自動重複削除は行わない。

実端末での操作：**製造記録メニューの「重複・削除診断」1回 →「診断結果をコピー」1回**。
取得できない層があっても結果には取得状況が含まれる。

検証：`npm test` PASS。
56 unit assertions、既存の全browser integration、追加のCASE A〜E・B＋E・期限切れ予約経路・診断UIを実行。
追加検証は本番接続を遮断したmock REST＋実IndexedDBで実施。
診断ボタン＋コピー前後の全localStorage/IndexedDB業務bundle不変、全通信GETのみ、認証SDK refresh不使用、
token非出力、存在しないDB非作成、mobile overflowなしを確認した。
既存の保護関数hash検査もPASS。
