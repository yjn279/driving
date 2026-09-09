# ドライブ荷重マッピング

iPhone の GPS と加速度センサーで走行を記録し、荷重（加速度の逆向き）の移り変わりを G-G ダイアグラムで振り返るアプリ。

## 起動

```bash
npm install
npx expo start
```

## マニュアル

使い方と仕様は `docs/` のドキュメントサイトにまとめている。手元で読むには次を実行する。

```bash
cd docs && PUPPETEER_SKIP_DOWNLOAD=1 npx mint@latest dev
```
