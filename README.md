# Chrono Desk｜時間與專案管理

這是一個以單一 HTML 檔案運作的 Vue 3 時間與專案管理儀表板。介面包含任務工作台、BI 圖表、公式指標、JSON 備份、CSV／ICS 行事曆交換與範本。

## 開啟方式

直接開啟 `index.html`，或在 GitHub Pages 啟用此儲存庫的 Pages（部署來源選 `main` 分支與根目錄）。頁面使用 CDN 載入 Vue 3、ECharts、Tailwind CSS、Lucide 與 html2pdf，因此需要網路連線。

## 本機資料

任務和設定儲存在瀏覽器的 `localStorage`。不同瀏覽器或裝置的資料不會自動同步；更換瀏覽器前請先從「匯入與匯出中心」下載 JSON 備份。

## Codex 開發

目前採用免建置的單頁架構，主要修改入口是 `index.html`。調整後請至少檢查 JavaScript 語法，並確認桌面與手機版的頁面操作、圖表及匯入匯出功能。
