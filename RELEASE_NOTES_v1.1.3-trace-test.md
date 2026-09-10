# ChatGPT Context Meter v1.1.3 Performance Trace Test

此版本不以再加速為主，而是精準找出長對話切換仍需約 3 秒的瓶頸。

## 新增診斷

「複製診斷資訊」新增 `perf_trace=`，會記錄一次對話切換的重要時間點：

- `pointerdown`：按下左側對話
- `sidebar_target_found`：辨識到目標 conversation
- `preloaded_show_start / painted`：RAM 完整快取開始/完成顯示
- `instant_stats_start / painted`：compact stats 即時顯示
- `route_changed`：ChatGPT SPA 完成網址切換
- `route_load_start`：新對話正式載入流程
- `load_cache_*`：快取恢復
- `latest_api_start / response / parsed`：最新頁 API
- `tokenizer_start / done`：增量 tokenizer
- `refresh_latest_painted`：背景校正完成

## 測試方式

請用同一個 40% 左右、已建立快取的長對話：

1. 從另一個已快取對話切過去。
2. 等百分比穩定。
3. 點開設定/問題排查，按「複製診斷資訊」。
4. 把整段診斷資訊貼回 ChatGPT。

不用測很多次，40% 長對話測 2 次即可。
