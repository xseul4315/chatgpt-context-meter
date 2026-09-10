# ChatGPT Context Meter v1.1.2 Test

目標：讓已快取對話在使用者點擊切換的當下就先顯示百分比，不等待 ChatGPT SPA 導航完成。

## 主要變更

- 新增 compact instant stats：每個 conversation 直接保存 token / count / chars / updatedAt 摘要。
- 啟動時把最近 conversation 的 compact stats 預熱到 RAM。
- 左側對話連結在 pointerdown capture 階段立即套用 RAM 快取百分比。
- 完整 messages cache 仍保留，用於背景最新頁同步與校正。
- 版本升至 1.1.2-test。

## 驗收目標

- 已有快取的長對話互切：目標 < 1 秒看到 pill 百分比。
- 之後 1–3 秒內可背景校正，但不能讓 pill 消失或顯示錯 conversation。
- 快速切換 3 個對話不得被舊請求覆蓋。
