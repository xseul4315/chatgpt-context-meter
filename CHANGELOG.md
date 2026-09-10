# v1.2.7

- 主畫面聚焦 Context 已使用百分比，顯示至小數 1 位。
- 新增較小字體的「對話正文」與「工具歷史」Token／占比拆分。
- 正式採用完整可讀 conversation history 作為 Context Load 參考值。
- 移除 Accuracy / Deep Stream Probe UI、MAIN-world probe 注入與相關診斷欄位。
- 保留複製診斷資訊、清除此對話快取、Tokenizer 與讀取狀態。
- 保留 v1.1.4 Instant Switch、cache restore 與背景同步行為。

# v1.2.4-classification-fix-test

- 不再用 reasoning_status 作為硬排除條件。
- Accuracy 對照改為原算法 / 較可信 final / 高可信 final / 特殊中介四項。
- 主畫面算法不變。

# v1.2.2-classification-send-probe-test

- 新增 message classification diagnostics。
- 同時計算現行 history tokens 與保守 final-text tokens。
- Cache schema 升至 4，首次強制重建 classification metadata。
- Probe 改為 Send-only POST/stream tracing，排除 GET conversation history。

# v1.2.1-targeted-stream-probe-test

- Targeted stream/request/response tracing。
- 記錄 endpoint、key tree、SSE/event type 與 model/token/context metadata。
- 不改主百分比公式。

# v1.2.0-accuracy-probe-test

- 新增手動 60 秒 Accuracy Probe。
- MAIN-world 被動觀察 ChatGPT backend / XHR / stream 的 usage/context/model/token metadata。
- 不改主百分比公式，不保存聊天本文。
- Probe 結果只存在頁面記憶體並可加入診斷資訊。

# v1.1.4-final-test

- 背景最新頁同步改為 silent reconciliation。
- 新增 background refresh lock 與 MutationObserver 去重。
- 移除重複 pointerdown listener。
- 診斷新增 display_ms / background_sync_ms。

# v1.1.3-trace-test

- 新增對話切換 Performance Trace。
- 不變更 Context 計算公式。
- 用於定位 40% 長對話約 3 秒切換延遲。

# v1.1.0-test

- Instant Switch：快取先顯示、最新頁背景校正。
- SPA 路由切換偵測加速。
- 最新頁改為增量 tokenizer。
- 新增 message fingerprint 與切換競態保護。

# Changelog

## v1.0.0
- 第一個正式發布版本。
- Chrome 實機驗證完成。
- 主畫面維持極簡：百分比、狀態、Token / Context 參考值與完整歷史讀取狀態。
- 使用完整 ChatGPT 對話歷史與瀏覽器本機 `o200k_base` tokenizer。
- 使用情境簡化為 ChatGPT 付費版 272k、Free / Go 128k，以及進階／自訂。
- 保留本機快取、一次性首次使用提示、友善 fallback 警示與 settings migration。
- 正式版不新增 Beta 期間以外的新核心功能，以已驗證穩定性為優先。

## v0.6.2-beta
- 完整歷史或 Tokenizer 失敗時，改成直接說明百分比可能偏低／存在誤差，並提供重試提示。
- 第一次啟用會自動開啟一次簡短說明；按「知道了」後不再出現。
- 新增穩定的 settings schema 與 migration：保留既有 v0.6.x 設定，並維持舊欄位以支援安全降版。
- 集中 cache payload migration 邏輯；目前 schema 3 快取不會因升級而被清除。
- 核心 Token 計算、Context 門檻與快取演算法不變。

## 0.6.1-beta
- 將裸露的 128k / 272k / 1.05M 選單改成「使用情境」。
- 預設顯示「ChatGPT 付費版 — 272k（建議）」。
- 提供「ChatGPT Free / Go — 128k」。
- 1.05M 與自訂值收進「進階／自訂」，降低一般使用者誤選機率。
- 保留既有 contextPreset 儲存格式，升級後原設定自動相容。

## 0.6.0-beta
- 主 UI 改成 Simple Sharing Edition。
- 主畫面只保留百分比、狀態、Token / Context 參考值與完整對話讀取狀態。
- 移除主畫面的字元數、訊息數、API 頁數、耗時、快取時間與 Tokenizer 技術資訊。
- 狀態文字改為「對話偏長 / 建議準備換視窗 / 建議換新視窗」。
- 門檻固定為 60% / 75% / 85%，不再提供一般 UI 調整。
- 設定只保留 Context 參考值；診斷與清除快取收進「問題排查」。
- 保留 v0.5.1 的完整歷史讀取、本機快取與 o200k_base tokenizer 核心，沿用既有 cache schema。

## 0.5.1-beta
- 修正 `.tiktoken` 詞彙表解析造成 Base64 `atob` 失敗。
