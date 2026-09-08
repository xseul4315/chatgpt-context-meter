# ChatGPT Context Meter v0.6.0-beta

一個專注於單一目的的小工具：**快速看目前這個 ChatGPT 對話大約走到 Context 參考值的幾 %。**

## 主畫面

只保留：百分比、狀態、Token / Context 參考值、完整對話讀取狀態。

## 狀態門檻

- 0–59%：正常
- 60–74%：對話偏長
- 75–84%：建議準備換視窗
- 85% 以上：建議換新視窗

v0.6 將門檻固定，不放在一般 UI 調整。

## Context 參考值

齒輪設定只保留：128k、272k（預設）、1.05M、自訂。

## 計算方式

`完整可讀 user / assistant 訊息 Token ÷ Context 參考值`

Token 由瀏覽器本機 `o200k_base` tokenizer 計算。第一次使用時下載 OpenAI 公開編碼詞彙表並做 SHA-256 驗證，之後本機快取。

## 重要限制

這不是 OpenAI 官方 Context 使用率。工具看不到系統提示、Memory、工具定義、訊息封裝 overhead、後端摘要／壓縮／裁切及當次輸出／推理保留空間。

## 隱私

聊天正文不送到第三方做 Token 計算。對話快取只保存 message ID、角色、字元數與 Token 數，不保存聊天全文；access token 不寫入 extension storage。

詳見 `PRIVACY.md`。
