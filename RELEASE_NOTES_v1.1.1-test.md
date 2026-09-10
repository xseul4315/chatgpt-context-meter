# ChatGPT Context Meter v1.1.1 Test

## Instant Switch 第二階段

- 啟動後預熱最近最多 30 個 conversation cache 到 RAM。
- 點擊 ChatGPT 側欄對話時，在 pointerdown 階段預測目的 conversation ID。
- 若 RAM 已有該對話快取，SPA 導航完成前先同步顯示百分比。
- 路由完成後仍會背景更新最新頁，保留 v1.1.0 的增量 tokenizer 與競態保護。

## 測試重點

1. 先讓兩個長對話都建立快取。
2. 重新整理一次 ChatGPT，等待目前對話顯示。
3. 用左側歷史清單在兩個長對話間切換。
4. 觀察黑色百分比 pill 是否接近瞬時切換。
5. 若使用瀏覽器上一頁/下一頁，仍應在約 250ms 內偵測並切換。
