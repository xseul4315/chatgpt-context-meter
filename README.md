# ChatGPT Context Meter v1.2.7

一個專注於單一目的的瀏覽器擴充功能：**快速查看目前 ChatGPT 對話的 Context Load，大約已使用所選 Context 參考值的幾 %。**

## 主畫面

主視覺聚焦於目前對話的 Context Load 百分比，並以較小字體拆分顯示：

- 對話正文 Token 數與占比
- 工具歷史 Token 數與占比

藉此讓使用者快速判斷目前對話是否已逐漸變長、變重，並決定是否需要準備切換至新的對話視窗。

## 狀態門檻

- 0–59%：正常
- 60–74%：對話偏長
- 75–84%：建議準備換視窗
- 85% 以上：建議換新視窗

目前狀態門檻為固定值，不在一般使用者介面中提供調整。

## 使用情境

設定頁提供較容易理解的 Context 參考值選項：

- ChatGPT 付費版參考值 — 272k（建議）
- ChatGPT Free / Go 參考值 — 128k
- 進階／自訂

`1.05M Token` 等較大型 Context 設定收納於「進階／自訂」，避免一般 ChatGPT 使用者誤選。

既有設定會在版本更新時自動相容，不需要重新設定。

> 實際可用 Context 規格可能因模型、方案與 ChatGPT 後端調整而改變。本工具不會從 OpenAI 後端自動取得官方 Context Window 上限，因此上述數值僅作為使用者可選擇的參考基準。

## 計算方式

主畫面的 Context Load 計算方式為：

`完整可讀對話歷史 Token（對話正文＋工具歷史）÷ Context 參考值`

Token 由瀏覽器本機的 `o200k_base` tokenizer 計算。

首次需要 tokenizer 詞彙資料時，擴充功能會下載公開編碼資源並進行 SHA-256 驗證；驗證完成後會保存在本機快取中，後續使用不需重複下載。

主畫面顯示的百分比代表的是 **Context Load 參考值**，主要用途是觀察長對話逐漸變重的程度，而不是還原 ChatGPT 後端實際 active context 的精確 Token 使用量。

## 重要限制

ChatGPT Context Meter 顯示的數值不是 OpenAI 官方 Context 使用率，也不是 ChatGPT 後端提供的即時 Token telemetry。

本工具無法得知或計算部分後端資訊，例如：

- System Prompt
- Memory
- 工具定義
- 訊息封裝與其他 overhead
- 後端摘要、壓縮或裁切
- Tool trace 在後端實際保留的比例
- 當次輸出的保留空間
- 推理或內部處理所使用的 Context

因此，本工具的用途是提供一致且實用的長對話負載指標，而不是作為 OpenAI 官方 Token 計量工具。

## 隱私

聊天正文不會傳送至第三方服務進行 Token 計算。

Token 計算完全在瀏覽器本機執行。

對話快取只保存必要的統計與識別資訊，例如：

- Message ID
- 角色
- 字元數
- Token 數

對話快取不保存聊天全文。

ChatGPT access token 亦不會寫入 extension storage。

詳細資料使用方式請參閱 `PRIVACY.md`。

## 可靠性與降級處理

- 若完整對話歷史讀取失敗並退回 DOM 讀取模式，主畫面會明確提示「僅讀取部分內容，數字可能偏低」。
- 若 `o200k_base` tokenizer 暫時無法使用，會改用本機粗估方式，並提示數值可能存在少量誤差。
- 第一次使用時會顯示一次簡短說明，之後不再重複干擾。
- 設定採用 schema migration，既有設定與相容快取不會因一般小版本更新而自動清除。
- 長對話切換時會優先使用本機快取顯示，再於背景同步最新資料，以降低等待時間。

## 專案定位

ChatGPT Context Meter 的設計目標不是反向推算 ChatGPT 後端的精確 Context Window 使用量，而是提供一個穩定、快速且容易理解的 **Conversation Context Load 指標**。

當對話歷史逐漸增加時，Context Load 也會隨之上升。使用者可以藉此提早判斷目前對話是否已經偏重，並在效能或操作體驗明顯下降之前準備切換新的對話視窗。
