(() => {
  const ROOT_ID = "jl-context-meter-root-v06";
  const EXT_VERSION = "0.6.0-beta";
  const CACHE_SCHEMA = 3;
  const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
  const MAX_CACHE_CONVERSATIONS = 30;
  const LATEST_THROTTLE_MS = 30000;

  const PRESETS = { "128k":128000, "272k":272000, "1m":1050000, "custom":null };
  const DEFAULTS = { contextPreset:"272k", customContextTokens:272000, warnPct:60, handoffPct:75, dangerPct:85 };

  const state = {
    config:{...DEFAULTS}, conversationId:null, messages:new Map(), source:"等待讀取",
    apiMode:"none", loading:false, lastError:"", lastUrl:location.href,
    lastLatestRefresh:0, initializedConversation:null, cacheUpdatedAt:0, cacheLoaded:false,
    copiedAt:0, lastLoadMs:0, tokenMethod:"等待 Tokenizer", tokenizerVerified:false,
    tokenizerOrigin:"unknown", tokenizerMs:0, exactTokenCount:false, tokenizerRunFailed:false
  };

  function formatNumber(n) {
    if (!Number.isFinite(n)) return "--";
    if (n >= 1000000) return (n/1000000).toFixed(2).replace(/\.00$/,"")+"M";
    if (n >= 1000) return Math.round(n/1000)+"k";
    return String(n);
  }
  function formatMs(ms) { return !Number.isFinite(ms)||ms<=0 ? "--" : (ms<1000 ? `${Math.round(ms)} ms` : `${(ms/1000).toFixed(1)} 秒`); }
  function formatAge(ts) {
    if (!ts) return "無"; const mins=Math.max(0,Math.floor((Date.now()-ts)/60000));
    if (mins<1) return "剛剛"; if (mins<60) return `${mins} 分鐘前`;
    const hrs=Math.floor(mins/60); return hrs<24 ? `${hrs} 小時前` : `${Math.floor(hrs/24)} 天前`;
  }
  function getContextLimit() {
    if (state.config.contextPreset==="custom") return Math.max(10000,Number(state.config.customContextTokens)||272000);
    return PRESETS[state.config.contextPreset]||272000;
  }
  function extractConversationId() { const m=location.pathname.match(/\/c\/([^/?#]+)/i); return m?m[1]:null; }
  function cacheKey(id){ return `jlcm:v05:conversation:${id}`; }
  function storageGet(area,keys){ return new Promise(r=>chrome.storage[area].get(keys,r)); }
  function storageSet(area,data){ return new Promise(r=>chrome.storage[area].set(data,r)); }
  function storageRemove(area,keys){ return new Promise(r=>chrome.storage[area].remove(keys,r)); }

  function estimateTokens(text) {
    if (!text) return 0; let cjk=0,other=0;
    for (const ch of text) /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u3040-\u30FF\uAC00-\uD7AF]/.test(ch)?cjk++:other++;
    return Math.max(0,Math.round(cjk*1.05+other/4));
  }

  function runtimeMessage(payload) {
    return new Promise((resolve,reject)=>{
      chrome.runtime.sendMessage(payload,response=>{
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        resolve(response);
      });
    });
  }

  async function tokenizerCounts(texts) {
    if (!texts.length) return [];
    if (state.tokenizerRunFailed) return texts.map(estimateTokens);
    try {
      const all=[];
      let i=0;
      while (i<texts.length) {
        const batch=[]; let chars=0;
        while (i<texts.length && batch.length<60 && chars<180000) {
          const t=String(texts[i++]??""); batch.push(t); chars+=t.length;
        }
        const res=await runtimeMessage({type:"JLCM_TOKENIZE_O200K",texts:batch});
        if (!res?.ok || !Array.isArray(res.counts)) throw new Error(res?.error||"Tokenizer 無回應");
        all.push(...res.counts);
        state.tokenMethod="o200k_base";
        state.tokenizerVerified=Boolean(res.verified);
        state.tokenizerOrigin=res.vocabularyOrigin||"unknown";
        state.tokenizerMs=(state.tokenizerMs||0)+(Number(res.tokenizeMs)||0);
        state.exactTokenCount=true;
      }
      return all;
    } catch(err) {
      state.tokenizerRunFailed=true;
      const message=`Tokenizer fallback：${err?.message||String(err)}`;
      if (!state.lastError.includes(message)) state.lastError = state.lastError ? `${state.lastError}；${message}` : message;
      state.tokenMethod = state.exactTokenCount ? "混合：o200k + 粗估" : "本機粗估 fallback";
      state.tokenizerVerified=false;
      state.exactTokenCount=false;
      return texts.map(estimateTokens);
    }
  }

  function textFromPart(part){
    if(typeof part==="string")return part; if(!part||typeof part!=="object")return "";
    if(typeof part.text==="string")return part.text; if(typeof part.content==="string")return part.content;
    if(typeof part.value==="string")return part.value; return "";
  }
  function visibleMessageText(msg){
    const role=msg?.author?.role??msg?.message?.author?.role??msg?.role??"";
    if(role!=="user"&&role!=="assistant")return "";
    const content=msg?.content??msg?.message?.content??null; if(!content)return "";
    if(typeof content==="string")return content.trim();
    const parts=Array.isArray(content.parts)?content.parts:[];
    if(parts.length)return parts.map(textFromPart).filter(Boolean).join("\n").trim();
    if(typeof content.text==="string")return content.text.trim(); return "";
  }
  function messageId(msg,i=0){ return msg?.id??msg?.message?.id??msg?.message_id??`${msg?.author?.role??msg?.role??"unknown"}:${i}:${visibleMessageText(msg).slice(0,80)}`; }

  async function addMessages(list){
    if(!Array.isArray(list))return 0;
    const prepared=[];
    list.forEach((msg,i)=>{
      const text=visibleMessageText(msg); if(!text)return;
      prepared.push({id:String(messageId(msg,i)),text,role:msg?.author?.role??msg?.message?.author?.role??msg?.role??""});
    });
    const counts=await tokenizerCounts(prepared.map(x=>x.text));
    prepared.forEach((x,i)=>state.messages.set(x.id,{id:x.id,role:x.role,text:null,chars:x.text.length,tokens:Number(counts[i])||0}));
    return prepared.length;
  }

  function getStats(){ let chars=0,tokens=0; for(const x of state.messages.values()){chars+=Number(x.chars)||0;tokens+=Number(x.tokens)||0;} return {chars,tokens,count:state.messages.size}; }
  function serializableMeta(){ return [...state.messages.values()].map(x=>({id:x.id,role:x.role,chars:Number(x.chars)||0,tokens:Number(x.tokens)||0})); }

  async function pruneCacheIndex(){
    const key="jlcm:v05:index"; const result=await storageGet("local",[key]); const index=Array.isArray(result[key])?result[key]:[];
    index.sort((a,b)=>(b.lastAccess||0)-(a.lastAccess||0)); const keep=index.slice(0,MAX_CACHE_CONVERSATIONS), remove=index.slice(MAX_CACHE_CONVERSATIONS);
    if(remove.length)await storageRemove("local",remove.map(x=>cacheKey(x.id))); await storageSet("local",{[key]:keep});
  }
  async function saveCache(id){
    if(!id||state.apiMode==="dom")return; const now=Date.now();
    await storageSet("local",{[cacheKey(id)]:{schema:CACHE_SCHEMA,updatedAt:now,tokenMethod:state.tokenMethod,tokenizerVerified:state.tokenizerVerified,messages:serializableMeta()}});
    const ik="jlcm:v05:index", r=await storageGet("local",[ik]); const arr=(Array.isArray(r[ik])?r[ik]:[]).filter(x=>x.id!==id);
    arr.unshift({id,lastAccess:now}); await storageSet("local",{[ik]:arr}); state.cacheUpdatedAt=now; state.cacheLoaded=true; pruneCacheIndex();
  }
  async function loadCache(id){
    if(!id)return false; const r=await storageGet("local",[cacheKey(id)]), p=r[cacheKey(id)];
    if(!p||p.schema!==CACHE_SCHEMA||!Array.isArray(p.messages))return false;
    state.messages.clear(); for(const x of p.messages){if(!x?.id)continue;state.messages.set(String(x.id),{id:String(x.id),role:x.role||"",text:null,chars:Number(x.chars)||0,tokens:Number(x.tokens)||0});}
    state.cacheUpdatedAt=Number(p.updatedAt)||0; state.cacheLoaded=true; state.tokenMethod=p.tokenMethod||"快取"; state.tokenizerVerified=Boolean(p.tokenizerVerified); state.exactTokenCount=state.tokenMethod==="o200k_base"&&state.tokenizerVerified;
    state.source=`⚡ 快取載入（${state.messages.size} 則）`; state.apiMode="cache"; return true;
  }
  async function clearCurrentCache(){
    const id=extractConversationId(); if(!id)return; await storageRemove("local",[cacheKey(id)]);
    const ik="jlcm:v05:index",r=await storageGet("local",[ik]); await storageSet("local",{[ik]:(Array.isArray(r[ik])?r[ik]:[]).filter(x=>x.id!==id)});
    state.cacheUpdatedAt=0;state.cacheLoaded=false;
  }

  async function getAccessToken(){try{const r=await fetch(`${location.origin}/api/auth/session`,{method:"GET",credentials:"include",cache:"no-store"});if(!r.ok)return null;const d=await r.json();return d?.accessToken||d?.access_token||null;}catch{return null;}}
  async function authedJson(url,token){const h={accept:"application/json"};if(token)h.authorization=`Bearer ${token}`;const r=await fetch(url,{method:"GET",credentials:"include",cache:"no-store",headers:h});if(!r.ok){const e=new Error(`HTTP ${r.status}`);e.status=r.status;throw e;}return r.json();}
  async function fetchNewApiPage(id,token,before=null){const u=new URL(`/backend-api/conversations/${encodeURIComponent(id)}`,location.origin);u.searchParams.set("include_has_versions","true");u.searchParams.set("num_turns","100");if(before)u.searchParams.set("before",before);return authedJson(u.toString(),token);}

  async function fullScanNewApi(id,token){
    state.messages.clear(); let before=null,page=0; const seen=new Set();
    while(page<100){const d=await fetchNewApiPage(id,token,before);await addMessages(d?.messages||d?.items||[]);const info=d?.page_info||d?.pageInfo||{};const has=info?.has_previous_page??info?.hasPreviousPage??false;const cur=info?.start_cursor??info?.startCursor??null;page++;if(!has||!cur||seen.has(cur))break;seen.add(cur);before=cur;}
    return {pages:page,messages:state.messages.size};
  }
  async function latestOnlyNewApi(id,token){const d=await fetchNewApiPage(id,token,null);await addMessages(d?.messages||d?.items||[]);return {messages:state.messages.size};}
  async function fullScanLegacyApi(id,token){
    const d=await authedJson(`${location.origin}/backend-api/conversation/${encodeURIComponent(id)}`,token), mapping=d?.mapping;
    if(!mapping||typeof mapping!=="object")throw new Error("Legacy API 沒有 mapping"); state.messages.clear(); const list=[];
    for(const node of Object.values(mapping))if(node?.message)list.push(node.message); await addMessages(list); return {messages:state.messages.size};
  }
  async function collectDomFallback(){
    const nodes=[...document.querySelectorAll('[data-message-author-role="user"], [data-message-author-role="assistant"]')], prepared=[];
    nodes.forEach((node,i)=>{if(node.closest(`#${ROOT_ID}`))return;const text=(node.innerText||node.textContent||"").trim();if(!text)return;const role=node.getAttribute("data-message-author-role")||"unknown";const id=node.getAttribute("data-message-id")||node.closest("[data-message-id]")?.getAttribute("data-message-id")||`dom:${role}:${i}:${text.slice(0,80)}`;prepared.push({id,text,role});});
    const counts=await tokenizerCounts(prepared.map(x=>x.text)); const map=new Map(); prepared.forEach((x,i)=>map.set(x.id,{id:x.id,role:x.role,text:null,chars:x.text.length,tokens:Number(counts[i])||0})); return map;
  }

  function resetTokenizerRun(){state.tokenizerMs=0;state.tokenizerRunFailed=false;if(!state.cacheLoaded){state.tokenMethod="等待 Tokenizer";state.tokenizerVerified=false;state.exactTokenCount=false;}}

  async function fullRefresh(){
    if(state.loading)return; const started=performance.now(),id=extractConversationId(); state.conversationId=id; state.loading=true; state.lastError=""; resetTokenizerRun(); state.source="完整歷史：讀取中…"; updateUI();
    try{
      if(!id){state.messages=await collectDomFallback();state.source="⚠️ DOM（目前畫面）";state.apiMode="dom";state.lastError="目前網址沒有可辨識的對話 ID";return;}
      const token=await getAccessToken();
      try{const r=await fullScanNewApi(id,token);state.source=`✅ 完整歷史（${r.pages} 頁 / ${r.messages} 則）`;state.apiMode="paged";state.initializedConversation=id;}
      catch(e1){const r=await fullScanLegacyApi(id,token);state.source=`✅ 完整歷史 Legacy（${r.messages} 則）`;state.apiMode="legacy";state.initializedConversation=id;}
      await saveCache(id);
    }catch(err){state.messages=await collectDomFallback();state.source="⚠️ DOM fallback（僅目前載入）";state.apiMode="dom";state.lastError=err?.message||String(err);}
    finally{state.loading=false;state.lastLatestRefresh=Date.now();state.lastLoadMs=performance.now()-started;updateUI();}
  }

  async function refreshLatestOnly(force=false){
    const id=extractConversationId();if(!id||state.loading)return;if(state.initializedConversation!==id&&!state.cacheLoaded){await fullRefresh();return;}if(!force&&Date.now()-state.lastLatestRefresh<LATEST_THROTTLE_MS)return;
    const started=performance.now();state.loading=true;state.lastError="";state.tokenizerMs=0;updateUI();
    try{const token=await getAccessToken();await latestOnlyNewApi(id,token);state.source=`⚡ 快取命中 + 最新頁（${state.messages.size} 則）`;state.apiMode="paged-cache";state.initializedConversation=id;await saveCache(id);}
    catch(err){state.lastError=`最新頁更新失敗：${err?.message||String(err)}`;}
    finally{state.loading=false;state.lastLatestRefresh=Date.now();state.lastLoadMs=performance.now()-started;updateUI();}
  }

  async function loadConversationSmart(){
    const started=performance.now(),id=extractConversationId();state.conversationId=id;state.messages.clear();state.cacheLoaded=false;state.cacheUpdatedAt=0;state.initializedConversation=null;state.lastError="";state.tokenizerMs=0;state.tokenizerRunFailed=false;
    if(!id){state.messages=await collectDomFallback();state.source="⚠️ DOM（目前畫面）";state.apiMode="dom";state.lastLoadMs=performance.now()-started;updateUI();return;}
    const has=await loadCache(id);if(has)updateUI();const fresh=has&&(Date.now()-state.cacheUpdatedAt<CACHE_TTL_MS)&&state.exactTokenCount;
    if(fresh){state.initializedConversation=id;await refreshLatestOnly(true);}else await fullRefresh();
  }

  function statusFor(pct){if(pct>=85)return["建議換新視窗","danger"];if(pct>=75)return["建議準備換視窗","handoff"];if(pct>=60)return["對話偏長","warn"];return["正常","ok"];} 
  function tokenizerLabel(){if(state.tokenMethod==="o200k_base")return state.tokenizerVerified?"o200k_base ✓":"o200k_base";return state.tokenMethod;}
  function buildDiagnostics(){
    const s=getStats(),limit=getContextLimit(),pct=limit?Math.round((s.tokens/limit)*1000)/10:0;
    return [
      `ChatGPT Context Meter ${EXT_VERSION}`,`host=${location.host}`,`conversation_id_present=${Boolean(extractConversationId())}`,
      `source=${state.source}`,`api_mode=${state.apiMode}`,`messages=${s.count}`,`chars=${s.chars}`,`history_tokens=${s.tokens}`,
      `context_reference=${limit}`,`history_ratio_pct=${pct}`,`token_method=${state.tokenMethod}`,`tokenizer_verified=${state.tokenizerVerified}`,
      `tokenizer_vocab_origin=${state.tokenizerOrigin}`,`tokenizer_ms=${Math.round(state.tokenizerMs||0)}`,`load_ms=${Math.round(state.lastLoadMs||0)}`,
      `cache=${state.cacheLoaded?"yes":"no"}`,`cache_age=${formatAge(state.cacheUpdatedAt)}`,`last_error=${state.lastError||"none"}`
    ].join("\n");
  }
  async function copyDiagnostics(){const text=buildDiagnostics();try{await navigator.clipboard.writeText(text);}catch{const ta=document.createElement("textarea");ta.value=text;ta.style.position="fixed";ta.style.opacity="0";document.body.appendChild(ta);ta.select();document.execCommand("copy");ta.remove();}state.copiedAt=Date.now();updateUI();setTimeout(updateUI,1600);}

  function simpleSourceLabel(){
    if(state.loading)return "正在讀取完整對話…";
    if(state.apiMode==="dom")return "⚠ 僅讀取目前畫面";
    if(state.apiMode==="paged-cache"||state.apiMode==="cache")return "✓ 完整對話已讀取（快取）";
    if(state.apiMode==="paged"||state.apiMode==="legacy")return "✓ 完整對話已讀取";
    return state.messages.size ? "✓ 對話已讀取" : "等待讀取";
  }

  function ensureUI(){
    if(document.getElementById(ROOT_ID))return;
    const root=document.createElement("div");root.id=ROOT_ID;root.innerHTML=`
      <button class="jlcm-pill" type="button" title="ChatGPT Context Meter"><span class="jlcm-dot"></span><span class="jlcm-pct">--%</span></button>
      <section class="jlcm-panel" hidden>
        <div class="jlcm-title-row">
          <strong>對話 Context <small>β</small></strong>
          <div class="jlcm-actions">
            <button class="jlcm-settings-toggle" type="button" title="設定" aria-label="設定">⚙</button>
            <button class="jlcm-refresh" type="button" title="重新讀取">↻</button>
            <button class="jlcm-close" type="button" aria-label="關閉">×</button>
          </div>
        </div>
        <div class="jlcm-big"><span class="jlcm-big-pct">--%</span><span class="jlcm-status">--</span></div>
        <div class="jlcm-bar"><div class="jlcm-bar-fill"></div></div>
        <div class="jlcm-primary-token">--</div>
        <div class="jlcm-simple-source">等待讀取</div>
        <div class="jlcm-error-simple" hidden></div>
        <details class="jlcm-about">
          <summary>這個數字怎麼算？</summary>
          <p>以完整可讀的 user / assistant 對話 Token，除以設定的 Context 參考值。這是長對話參考指標，不是 OpenAI 官方或實際 Context 使用率。</p>
        </details>
        <section class="jlcm-settings-panel" hidden>
          <div class="jlcm-settings-title">設定</div>
          <label>Context 參考值
            <select class="jlcm-preset"><option value="128k">128k Token</option><option value="272k">272k Token</option><option value="1m">1.05M Token</option><option value="custom">自訂</option></select>
          </label>
          <label class="jlcm-custom-row">自訂 Token<input class="jlcm-custom-input" type="number" min="10000" step="1000"></label>
          <button class="jlcm-save" type="button">儲存</button>
          <details class="jlcm-troubleshoot">
            <summary>問題排查</summary>
            <div class="jlcm-tools"><button class="jlcm-diagnostics" type="button">複製診斷資訊</button><button class="jlcm-clear-cache" type="button">清除此對話快取</button></div>
            <div class="jlcm-copy-status"></div>
            <div class="jlcm-techline">Tokenizer：<span class="jlcm-token-method">--</span> · 讀取：<span class="jlcm-source">--</span></div>
          </details>
        </section>
        <div class="jlcm-footnote">數值僅供參考，非 OpenAI 官方 Context 使用率。</div>
        <div class="jlcm-version">v${EXT_VERSION}</div>
      </section>`;
    document.documentElement.appendChild(root);
    const panel=root.querySelector(".jlcm-panel"),settings=root.querySelector(".jlcm-settings-panel");
    root.querySelector(".jlcm-pill").addEventListener("click",()=>{panel.hidden=!panel.hidden;syncInputs();});
    root.querySelector(".jlcm-close").addEventListener("click",()=>panel.hidden=true);
    root.querySelector(".jlcm-settings-toggle").addEventListener("click",()=>{settings.hidden=!settings.hidden;syncInputs();});
    root.querySelector(".jlcm-refresh").addEventListener("click",fullRefresh);
    root.querySelector(".jlcm-diagnostics").addEventListener("click",copyDiagnostics);
    root.querySelector(".jlcm-clear-cache").addEventListener("click",async()=>{await clearCurrentCache();state.source="快取已清除；正在重新讀取…";updateUI();await fullRefresh();});
    root.querySelector(".jlcm-preset").addEventListener("change",updateCustomVisibility);
    root.querySelector(".jlcm-save").addEventListener("click",()=>{
      const contextPreset=root.querySelector(".jlcm-preset").value;
      const customContextTokens=Math.max(10000,Number(root.querySelector(".jlcm-custom-input").value)||272000);
      state.config={...state.config,contextPreset,customContextTokens,warnPct:60,handoffPct:75,dangerPct:85};
      chrome.storage.sync.set(state.config);syncInputs();updateUI();settings.hidden=true;
    });
  }
  function updateCustomVisibility(){const r=document.getElementById(ROOT_ID);if(!r)return;const row=r.querySelector(".jlcm-custom-row");if(row)row.style.display=r.querySelector(".jlcm-preset").value==="custom"?"grid":"none";}
  function syncInputs(){const r=document.getElementById(ROOT_ID);if(!r)return;r.querySelector(".jlcm-preset").value=state.config.contextPreset;r.querySelector(".jlcm-custom-input").value=state.config.customContextTokens;updateCustomVisibility();}
  function updateUI(){
    ensureUI();const r=document.getElementById(ROOT_ID);if(!r)return;
    const s=getStats(),limit=getContextLimit(),pctRaw=limit?(s.tokens/limit)*100:0,pct=Math.max(0,Math.round(pctRaw)),bar=Math.max(0,Math.min(100,pctRaw)),[label,cls]=statusFor(pctRaw);
    r.dataset.status=cls;
    r.querySelector(".jlcm-pct").textContent=state.loading?"…":`${pct}%`;
    r.querySelector(".jlcm-big-pct").textContent=state.loading?"…":`${pct}%`;
    r.querySelector(".jlcm-status").textContent=state.loading?"讀取中":label;
    const prefix=state.exactTokenCount?"":"約 ";
    r.querySelector(".jlcm-primary-token").textContent=`${prefix}${formatNumber(s.tokens)} / ${formatNumber(limit)} Token`;
    r.querySelector(".jlcm-simple-source").textContent=simpleSourceLabel();
    r.querySelector(".jlcm-source").textContent=state.source;
    r.querySelector(".jlcm-token-method").textContent=tokenizerLabel();
    r.querySelector(".jlcm-bar-fill").style.width=`${bar}%`;
    const e=r.querySelector(".jlcm-error-simple");
    if(state.lastError){e.hidden=false;e.textContent=state.tokenizerRunFailed?"⚠ Tokenizer 暫時改用本機粗估；可在設定的問題排查中複製診斷資訊。":"⚠ 讀取出現問題；可在設定的問題排查中查看診斷資訊。";}else{e.hidden=true;e.textContent="";}
    r.querySelector(".jlcm-copy-status").textContent=Date.now()-state.copiedAt<1500?"已複製（不含對話內容與對話 ID）":"";
  }
  function initSettings(){return new Promise(resolve=>chrome.storage.sync.get(DEFAULTS,items=>{state.config={...DEFAULTS,...items};resolve();}));}
  async function init(){await initSettings();ensureUI();syncInputs();updateUI();await loadConversationSmart();setInterval(()=>{if(location.href!==state.lastUrl){state.lastUrl=location.href;setTimeout(loadConversationSmart,900);}},800);let debounce=null;const ob=new MutationObserver(()=>{clearTimeout(debounce);debounce=setTimeout(()=>refreshLatestOnly(false),2500);});ob.observe(document.documentElement,{subtree:true,childList:true,characterData:true});}
  init();
})();
