# 電子書翻閱器生成器

上傳圖片，一鍵生成可翻頁的電子書並部署到 Vercel，取得能嵌入 Miro（或其他平台）的網址。

## 🔗 製作網址（線上使用）

### 👉 https://builder-eight-delta.vercel.app

> **存取密碼請向作者本人索取。**

## 使用步驟

1. 開啟上面的網址，輸入**存取密碼**
2. 填寫**書本名稱**（會成為網址的一部分）
3. **上傳頁面圖片**（可拖曳排序，依頁序）
4. 按「⚡ 生成並部署電子書」，等約 40–60 秒
5. 取得**書本網址** → 複製 → 貼進 Miro（＋ → Embed）

> 第一次貼進 Miro 若沒自動貼合，網址後面加 `?v=1`（之後可改 `?v=2`、`?v=3`…）強制重新讀取。

## 特色

- **單頁呈現、填滿卡片**：一次一頁、置中，邊距極小
- **自動配合圖片比例**：依第一張圖的實際長寬設定書頁與嵌入卡片，橫圖、直圖都不留多餘白邊
- **放大鏡 / 全螢幕**：右上角工具列
- **Miro 自動貼合**：每本書附 oEmbed 中繼資料，讓嵌入卡片依比例自動成形
- **透明背景**：融入 Miro 白卡片

## 技術說明

- 前端：`public/index.html`（上傳介面）
- 翻閱器模板：`lib/template.js`（page-flip 函式庫）
- 部署：`api/deploy.js`（Vercel Function）／`server.js`（本機 Express）
  - 兩階段部署：先取得實際公開網址，再寫入 oEmbed 後重新部署
- 部署所需環境變數：`VERCEL_DEPLOY_TOKEN`、`VERCEL_DEPLOY_TEAM_ID`、`BUILDER_PASSWORD`（存取密碼，不寫在程式碼中）

## 本機開發

```bash
npm install
node server.js          # 啟動於 http://localhost:3456
```
