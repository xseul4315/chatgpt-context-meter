# Changelog

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
