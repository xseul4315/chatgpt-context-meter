# Privacy

ChatGPT Context Meter v0.6.0-beta 讓 Token 計算與統計盡可能留在本機。

- 會在目前登入的 ChatGPT 頁面內讀取該對話歷史，用來計算 user / assistant 訊息 Token。
- 聊天正文不會傳送到第三方 Token 計算服務。
- `o200k_base` tokenizer 第一次使用時會下載 OpenAI 公開詞彙表並驗證 SHA-256；下載的是詞彙表，不是上傳聊天內容。
- 對話快取只保存 message ID、role、字元數、Token 數，不保存訊息正文。
- access token 不寫入 extension storage，也不傳送到第三方網站。
- 「複製診斷資訊」不包含聊天正文或 conversation ID。
