# 1. 全体方針・コミュニケーション

- ユーザーは日本人です。コード内コメント・最終出力メッセージ・ユーザーへの質問は日本語でお願いします。
- 既存のコードコメントは、明示的な指示がない限り変更しない。
- `src/scripts` 以下の TypeScript コードを実行するときは `node --import tsx ./src/scripts/hello.ts`
- 砲台ゲームの仕様を変更した場合は houdai-shiyou.md も変更する。

ライブラリ概要

- 言語: TypeScript
- UI: React v19
- Lint: biome v2
- ルーティング: react-router-dom（`BrowserRouter` + `Routes` + `Route`）を使用。ルート定義は `src/App.tsx`
- ビルドはvite v8

# 2. TypeScript / コーディングスタイル

- 型定義は `interface` ではなく 必ず `type` を使う。
- `any` 型は 絶対に使用しない。
- 型アサーション `as` は原則使用しない。やむを得ず `as` を使う場合は、なぜ必要かをコードコメントで説明すること。
- `class` 構文は 一切使用しない。
- 関数定義は すべてアロー関数 を使用する。
- 条件分岐は 早期リターンを用いてフラットに保つ。
- `try-catch` は乱用せず、必要最低限のみ使用する。
