# 製造実績・分析 STEP2 検証

`npm test` で既存の全単体テスト、同期・保存・削除・履歴ブラウザ統合テストとSTEP2ブラウザ統合テストを実行する。
ブラウザは隔離origin / 新規context / モックRESTのみを使う。本番Supabaseに接続しない。

実装は正規化済み履歴の読み取り専用。新規CDN・グラフライブラリ・DB変更なし。
既存の数量区分・理論完成重量を再利用。個別保存歩留まりは変更しない。
比較基準は期間の最終月（全期間・終了日未指定は該当記録の最新月、記録なしは今月）。比較は各月全体を同一商品・製造区分で集計し、指定期間の部分月集計と区別して説明する。

| 必須項目 | 自動検証 |
| --- | --- |
| 1〜3 月別数量・月境界・年境界 | manufacturing-analysis.test.cjs：12/31・1/1・1/31・2/1、製造日基準 |
| 4〜8 商品・単位・ハーブ・ジビエ・峠区分 | 単体で商品/kind/unit別集計、ブラウザで各グラフと数値表 |
| 9〜10 加重歩留まり・欠損と0 | 単体・ブラウザ：57.5%、0%、欠損月の線接続なし、対象件数、数量未設定 |
| 11 前月・前年同月 | 単体の年境界、ブラウザの基準月・数値・ポイント差、商品/製造区分 |
| 12 データなし | 空配列、空期間、比較の「データなし」、ブラウザエラーなし |
| 13 絞り込み連動 | 商品・区分・期間でサマリー/グラフ/一覧/集計表が変化 |
| 14 削除済み除外 | STEP2ブラウザの削除行、既存record-observation統合のローカル/クラウドtombstone |
| 15 同一LOT別ID保持 | 単体・STEP2ブラウザ、既存record-observation統合 |
| 16 既存一覧・商品別表 | 既存sync/record-observation統合、STEP2一覧から詳細へ遷移 |
| 17 iPad相当幅 | STEP2ブラウザ：768/820/1024/1366px、390px、横はみ出しなし |
| 18 データ不変 | 単体input不変、ブラウザlocalStorage/IndexedDBの前後deepEqual、既存保存値123%の維持 |
| 19 オフライン | STEP2 offline context、既存sync統合のIndexedDBのみ履歴 |
| 20 全既存テスト | npm test |

日付順の変更でグラフDOMが同じことも検証。変更のない絞り込みイベントは再描画しない。
数値表には月別対象件数と未設定件数を併記する。
実機確認：iPad Safariのタッチスクロール、縦横回転、ホーム画面起動時の既存キャッシュ更新。

最終検証結果：単体83件 PASS / FAIL 0。既存sync-integration、record-observation-integration、history-startup-integration、新規manufacturing-analysis-integrationの4本すべてPASS。`git diff --check`、JavaScript構文チェックもPASS。
