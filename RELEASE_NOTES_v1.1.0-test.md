# ChatGPT Context Meter v1.1.0 Test

此版本用於測試「Instant Switch」效能優化，暫不建議直接發布。

## 主要變更

- 切換 ChatGPT 對話時，優先立即顯示該 conversation 的本機快取結果。
- Chromium Navigation API + popstate/hashchange + 250ms fallback poll，取代原本最慢約 1.7 秒的 URL 偵測延遲。
- 快取顯示後約 60ms 再背景同步最新頁，讓畫面先出結果。
- 最新頁只對新增或已變更訊息重新 tokenizer，不再重算整個最新 100 則。
- 新增 message fingerprint，後續可辨識相同 message ID 但內容已變更的情況。
- 加入 load epoch，降低快速切換對話時舊請求覆蓋新對話結果的風險。
- 診斷資訊新增 incremental_tokenized，方便確認增量計算是否生效。

## 測試重點

1. 在兩個已經讀取過、已有快取的長對話之間來回切換。
2. 觀察右下角百分比是否幾乎立即出現。
3. 點開診斷資訊，確認 incremental_tokenized 通常是 0 或少量訊息，而不是整頁重算。
4. 在目前對話新增一則 user/assistant 訊息後，確認百分比能更新。
5. 快速連續切換 3 個對話，確認不會顯示錯誤對話的百分比。
