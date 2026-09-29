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

# 3. ブラウザでの動作確認（three.js / WebGL）

three.js を使うページ（`/subway-rush` など）をヘッドレス Chrome で確認するときは、以下に従う。守らないと `THREE.WebGLRenderer: Error creating WebGL context.` で必ず失敗する。

- **原因**: この環境には X11 転送用の `DISPLAY=localhost:10.0` が設定されている。Chrome が ANGLE/Vulkan の初期化で X に接続しようとして失敗し（`xcb_connect() failed`）、WebGL が無効になる。
- **対処**: `DISPLAY` を外して起動し、`--use-angle=swiftshader --enable-unsafe-swiftshader` を付ける。サンドボックスを無効にする必要はない。
- **やり方**: `playwright-cli open` の `--config` では起動引数が効かなかった。playwright-core を直接使う Node スクリプトをスクラッチパッドに置き、`env -u DISPLAY node shot.mjs` で実行する。

```js
import { chromium } from '/home/thr3a/.local/share/mise/installs/node/24.12.0/lib/node_modules/@playwright/cli/node_modules/playwright-core/index.mjs';
const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome', // Playwright 同梱のブラウザはバージョンが合わず起動しない
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
});
const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2 });
await page.goto('http://localhost:5199/subway-rush');
// WebGL が使えるかを最初に確認する
console.log(await page.evaluate(() => !!document.createElement('canvas').getContext('webgl2')));
```

- 上の `console.log` が `false` なら、ゲームのコードより先に起動方法を疑う。
