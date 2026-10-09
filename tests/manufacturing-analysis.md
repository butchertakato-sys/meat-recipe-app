# 製造実績・分析 STEP1

基準: a433a4456ae138a68690c0deaf7cedd1e9c184b8

## 取得・日付・商品

`MeatProductionSync.getLocalHistory()` を直接読み、既存の `cachedBundleToManufacturingRecord` → `combinedManufacturingHistory`（canonical統合）を使用する。同期初期化・refresh・クラウドアクセスは行わない。IndexedDB失敗時は既存メモリ／localStorage由来のcanonical履歴を表示する。保存形式・保存処理は変更しない。

日付は既存履歴の `date`（製造日）。商品は既存adapterの `internalCode`、`SUPABASE_PRODUCT_TO_LEGACY_ID`、既存商品判定、`PRODUCT_MASTER`で解決する。未知の商品は元の名称と識別子を維持する。

## 重量と平均歩留まり

仕込み重量は既存歩留まりの分母 `theoreticalFinishedWeight`。肉だけの `meatTotal` は使わない。完成重量は正規化履歴の `actualFinishedWeightG`（代替 `finishedWeight`）、各回歩留まりは `actualYieldPercent`（代替 `yieldRate`）を読む。分析独自の各回計算・数量からの重量再計算は行わない。

商品別平均は、正の仕込み重量と完成重量（0を含む）が揃った記録について `Σ完成重量 / Σ仕込み重量 × 100`。欠損を0として分母へ混ぜず、対象件数を表示。合計重量の欠損件数も表示する。gのまま集計し表示時にkgへ変換。

## 数量対応

|対象|フィールド|単位・内訳|
|---|---|---|
|通常商品|packageCount|保存済みpackagingUnit（パック／袋など）|
|本数管理商品・委託商品|completedCount|packagingUnitが本の場合、本|
|ハーブ|herbStandardPackageCount / herbEventPieceCount|通常パック／イベント本を分離|
|旧ハーブ単独記録|packageCount / completedCount|既存herbRecordOptionIdで通常／イベント判定|
|ジビエ|smokedCount / unsmokedCount|燻製本／燻製なし本を分離|
|峠の茶屋向け割当|togePieceCount|togeAllocationEnabled時に別内訳、本|

単位未設定は推測せず明記する。同じ商品でも異なる保存単位は別集計。全商品の数量総合計は作らない。

## 検証

- 既存41件＋分析13件の単体テスト。
- 既存ブラウザ統合テスト＋分析のcanonical件数、商品・期間・製造区分、ハーブ内訳、詳細遷移、iPhone幅の横スクロール、IndexedDBのみのオフライン表示、業務データ不変、追加通信0件。
- 実データ回帰は既存のCHORIZO 37／ARABIKI 11／HERB 0・161のfixture。実運用DBへの書込みはしていない。
- WindowsではCHROMIUM_PATHにEdge等を指定。npm test相当として `node --test tests/*.test.cjs` と `node tests/sync-integration.cjs` を実行。
