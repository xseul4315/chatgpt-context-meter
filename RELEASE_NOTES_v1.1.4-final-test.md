# ChatGPT Context Meter v1.1.4 Final Test

此版本收尾 v1.1.x 的 Instant Switch 效能優化；Context 計算公式不變。

## 主要修正

- 最新頁 API 改為真正的背景靜默校正：背景同步期間不再把 pill 變成 `…`。
- 新增獨立 background refresh lock，避免同一 conversation 重複同步。
- MutationObserver 在 30 秒 throttle 期間不再排程無效 refresh。
- 移除重複的第二個 pointerdown listener。
- 完整預載 cache 不存在時，仍可 fallback 到 compact RAM stats。
- 診斷新增 `display_ms` 與 `background_sync_ms`，把「看見百分比」和「背景 API 完成」分開計時。

## 驗收目標

1. 已快取的 40%～50% 長對話互切，pill 應立即顯示且不閃成 `…`。
2. 背景同步可花 1～3 秒，但百分比應持續可見。
3. 無新訊息時 `incremental_tokenized=0`。
4. `display_ms` 預期通常低於 100 ms。
5. 快速連切 3 個已快取對話，不應顯示錯誤 conversation 的結果。
