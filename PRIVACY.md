# Privacy Policy

## ChatGPT Context Meter

ChatGPT Context Meter 會在使用者目前登入的 ChatGPT 頁面中讀取對話內容，用於計算對話 Token 數與 Context 參考百分比。

### 資料使用

- 讀取目前 ChatGPT 對話中的 user / assistant 訊息，以提供 Context Meter 功能。
- Token 計算在使用者的瀏覽器本機執行。
- 聊天正文不會傳送給開發者或第三方 Token 計算服務。
- 對話快取僅保存計算所需的統計資訊，例如 message ID、角色、字元數與 Token 數，不保存聊天正文。
- ChatGPT access token 不會寫入 extension storage，也不會傳送給開發者或第三方網站。

### Tokenizer

第一次需要使用 `o200k_base` tokenizer 時，擴充功能會透過 HTTPS 下載 OpenAI 公開的 tokenizer 詞彙資料，並進行 SHA-256 驗證。

此過程只下載 tokenizer 資料，不會將 ChatGPT 對話內容傳送至該來源。

### 第三方分享

ChatGPT Context Meter 不出售、分享或轉移使用者的 ChatGPT 對話內容給第三方。

使用者資料僅用於提供 ChatGPT Context Meter 所描述的單一功能。

### 診斷資訊

「複製診斷資訊」功能不包含聊天正文或 conversation ID。

### 資料保存

聊天正文不會由 ChatGPT Context Meter 持久保存。

本機統計快取可由擴充功能更新或清除，且不包含聊天正文。

### Chrome Web Store Limited Use

ChatGPT Context Meter 對使用者資料的使用僅限於提供與改善其單一用途：估算目前 ChatGPT 對話的 Token 數與 Context 參考比例。

使用者資料不會用於廣告、信用評估、資料販售或其他與此功能無關的用途。
