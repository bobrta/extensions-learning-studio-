# Chrono Desk｜時間與專案管理

這是一個以單一 HTML 檔案運作的 Vue 3 時間與專案管理儀表板。介面包含任務工作台、BI 圖表、公式指標、JSON 備份、CSV／ICS 行事曆交換與範本。

## 研究知識庫（初步）

已新增可獨立開啟的運動與睡眠／休息公式知識庫，包含 50 項運動公式、56 項睡眠／休息公式、兩個試算器、原則、注意事項、來源對照與 JSON 自訂條目匯入／匯出。它位於獨立子目錄，不會改動根目錄 Chrono Desk 主程式。

- [開啟健康時間公式知識庫](knowledge/health-time/index.html)
- [閱讀公式與證據規格](knowledge/health-time/docs/公式與證據規格.md)

## Chrono Planner 排程模組

新增獨立的時間排程與回顧模組，含待辦與行程、週／日行事曆、計畫與實際記錄、重複行程、排程建議、分析、知識卡和資料匯入匯出。所有排程資料只存於目前瀏覽器的 localStorage，不會隨程式提交上傳。

- [開啟 Chrono Planner](apps/chrono-planner/index.html)
- [開啟保留原介面的 Chrono Desk 整合版](apps/chrono-planner/ChronoDesk-整合版.html)
- [閱讀模組說明與測試方式](apps/chrono-planner/README.md)

## 開啟方式

直接開啟 `index.html`，或在 GitHub Pages 啟用此儲存庫的 Pages（部署來源選 `main` 分支與根目錄）。頁面使用 CDN 載入 Vue 3、ECharts、Tailwind CSS、Lucide 與 html2pdf，因此需要網路連線。

## 本機資料

任務和設定儲存在瀏覽器的 `localStorage`。不同瀏覽器或裝置的資料不會自動同步；更換瀏覽器前請先從「匯入與匯出中心」下載 JSON 備份。

## Codex 開發

目前採用免建置的單頁架構，主要修改入口是 `index.html`。調整後請至少檢查 JavaScript 語法，並確認桌面與手機版的頁面操作、圖表及匯入匯出功能。
