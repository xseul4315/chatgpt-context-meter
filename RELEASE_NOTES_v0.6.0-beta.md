# ChatGPT Context Meter v0.6.0-beta

第一個適合分享給朋友測試的 Beta 版本。

## 主要功能

- 右下角直接顯示目前對話的 Context 參考百分比。
- 點開後只保留百分比、狀態、Token / Context 參考值與完整歷史讀取狀態。
- 使用完整 ChatGPT 對話歷史，不受畫面只載入部分訊息影響。
- 使用瀏覽器本機 `o200k_base` tokenizer 計算 user / assistant 訊息 Token。
- 支援 128k、272k、1.05M 與自訂 Context 參考值。
- 本機快取降低重複讀取完整歷史的成本。
- 聊天正文不送到第三方做 Token 計算。

## 狀態門檻

- 0–59%：正常
- 60–74%：對話偏長
- 75–84%：建議準備換視窗
- 85% 以上：建議換新視窗

## 重要說明

這不是 OpenAI 官方 Context 使用率。工具無法看到系統提示、Memory、工具定義、訊息封裝 overhead、後端摘要／壓縮／裁切，以及模型為輸出或推理保留的空間。

## 安裝

下載 ZIP 後解壓縮，再於 Chrome `chrome://extensions` 或 Edge `edge://extensions` 開啟開發人員模式並載入未封裝項目。
