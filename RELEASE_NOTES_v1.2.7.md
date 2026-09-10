# ChatGPT Context Meter v1.2.7

## Release candidate

這版定版重點：

- Context 已使用百分比為主視覺，顯示 1 位小數。
- 下方以較小、較淡文字拆分：
  - 對話正文 Token / Context %
  - 工具歷史 Token / Context %
- 完整 conversation history 作為長對話 Context Load 參考值。
- Accuracy / Deep Stream Probe 已從正式 runtime 完整移除。
- 問題排查只保留必要診斷、快取清除、Tokenizer 與讀取狀態。
- v1.1.4 Instant Switch / cache / background sync 核心不變。

## 定位

本工具的百分比是「長對話負載參考值」，用來協助判斷對話是否已經偏重、可能需要準備換新視窗；不是 OpenAI 官方 active-context telemetry。
