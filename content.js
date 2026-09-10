(() => {
  const ROOT_ID = "jl-context-meter-root-v06";
  const EXT_VERSION = "1.2.7";
  const SETTINGS_SCHEMA = 1;
  const SETTINGS_KEY = "jlcm:settings";
  const ONBOARDING_KEY = "jlcm:onboarding:v1";
  const CACHE_SCHEMA = 5;
  const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
  const MAX_CACHE_CONVERSATIONS = 30;
  const LATEST_THROTTLE_MS = 30000;
  const ROUTE_POLL_MS = 250;

  const PRESETS = { "128k":128000, "272k":272000, "1m":1050000, "custom":null };
  const DEFAULTS = { contextPreset:"272k", customContextTokens:272000, warnPct:60, handoffPct:75, dangerPct:85 };

  const instantStats = new Map();

  let perfTrace = { id:"", started:0, events:[] };
  function traceReset(id,label="switch"){
    perfTrace={id:String(id||""),started:performance.now(),events:[]};
    traceMark(label);
  }
  function traceMark(label,extra=""){
    if(!perfTrace.started)return;
    const ms=Math.round((performance.now()-perfTrace.started)*10)/10;
    perfTrace.events.push({label:String(label),ms,extra:String(extra||"")});
    if(perfTrace.events.length>30)perfTrace.events.shift();
  }
  function traceText(){
    if(!perfTrace.started||!perfTrace.events.length)return "none";
    return perfTrace.events.map(x=>`${x.label}@${x.ms}ms${x.extra?`(${x.extra})`:""}`).join(" > ");
  }

  const state = {
    config:{...DEFAULTS}, conversationId:null, messages:new Map(), source:"等待讀取",
    apiMode:"none", loading:false, lastError:"", lastUrl:location.href,
    lastLatestRefresh:0, initializedConversation:null, cacheUpdatedAt:0, cacheLoaded:false,
    copiedAt:0, lastLoadMs:0, tokenMethod:"等待 Tokenizer", tokenizerVerified:false,
    tokenizerOrigin:"unknown", tokenizerMs:0, exactTokenCount:false, tokenizerRunFailed:false,
    onboardingVisible:false, loadEpoch:0, loadingEpoch:0, lastTokenizedMessages:0,
    preloadedCaches:new Map(),
    latestRefreshInFlight:false, latestRefreshId:null,
    lastInstantDisplayMs:0, lastBackgroundSyncMs:0,
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

  function normalizeConfig(raw={}) {
    const allowed=new Set(["128k","272k","1m","custom"]);
    const contextPreset=allowed.has(raw.contextPreset)?raw.contextPreset:DEFAULTS.contextPreset;
    const customContextTokens=Math.max(10000,Number(raw.customContextTokens)||DEFAULTS.customContextTokens);
    return {
      contextPreset,
      customContextTokens,
      warnPct:60,
      handoffPct:75,
      dangerPct:85
    };
  }

  async function initSettings(){
    const legacyKeys=["contextPreset","customContextTokens","warnPct","handoffPct","dangerPct"];
    const data=await storageGet("sync",[SETTINGS_KEY,ONBOARDING_KEY,...legacyKeys]);
    const stable=data[SETTINGS_KEY];
    const legacy={};
    for(const k of legacyKeys) if(data[k]!==undefined) legacy[k]=data[k];

    // Prefer the stable settings object. If it does not exist yet, migrate the
    // v0.6.x top-level keys without deleting them, so downgrades still work.
    const candidate=stable&&typeof stable==="object" ? stable : legacy;
    state.config=normalizeConfig(candidate);

    const stablePayload={schema:SETTINGS_SCHEMA,...state.config};
    const stableNeedsWrite=!stable || stable.schema!==SETTINGS_SCHEMA ||
      stable.contextPreset!==state.config.contextPreset ||
      Number(stable.customContextTokens)!==state.config.customContextTokens;

    if(stableNeedsWrite){
      await storageSet("sync",{
        [SETTINGS_KEY]:stablePayload,
        ...state.config
      });
    }

    state.onboardingVisible=data[ONBOARDING_KEY]!==true;
  }

  async function saveSettings(){
    const payload={schema:SETTINGS_SCHEMA,...state.config};
    // Keep legacy top-level fields alongside the stable object for safe downgrade.
    await storageSet("sync",{[SETTINGS_KEY]:payload,...state.config});
  }

  async function dismissOnboarding(){
    state.onboardingVisible=false;
    await storageSet("sync",{[ONBOARDING_KEY]:true});
    const r=document.getElementById(ROOT_ID);
    if(r){
      const box=r.querySelector(".jlcm-first-use");
      if(box) box.hidden=true;
    }
  }

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
    traceMark("tokenizer_start",`${texts.length} msgs`);
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
      traceMark("tokenizer_done",`${all.length} msgs`);
      return all;
    } catch(err) {
      state.tokenizerRunFailed=true;
      const message=`Tokenizer fallback：${err?.message||String(err)}`;
      if (!state.lastError.includes(message)) state.lastError = state.lastError ? `${state.lastError}；${message}` : message;
      state.tokenMethod = state.exactTokenCount ? "混合：o200k + 粗估" : "本機粗估 fallback";
      state.tokenizerVerified=false;
      state.exactTokenCount=false;
      traceMark("tokenizer_fallback",`${texts.length} msgs`);
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

  function messageMeta(msg){
    return msg?.metadata ?? msg?.message?.metadata ?? {};
  }
  function messageContentType(msg){
    const c=msg?.content ?? msg?.message?.content ?? null;
    return String(c?.content_type ?? c?.type ?? "unknown");
  }
  function classifyMessage(msg){
    const role=String(msg?.author?.role??msg?.message?.author?.role??msg?.role??"");
    const meta=messageMeta(msg);
    const contentType=messageContentType(msg);
    const channel=String(msg?.channel??msg?.message?.channel??"");
    const recipient=String(msg?.recipient??msg?.message?.recipient??"");
    const toolSummary=String(meta?.tool_summary_type??"");
    const endTurn=Boolean(msg?.end_turn??msg?.message?.end_turn??false);

    if(role==="user") return "user";
    if(role!=="assistant") return "other_role";

    // Hard excludes: these are clearly not normal final assistant answers.
    if(contentType==="thoughts") return "assistant_thoughts";
    if(channel==="analysis") return "assistant_analysis_channel";
    if(toolSummary) return "assistant_tool_summary";

    // `recipient` alone is not a reliable tool-call signal. Observed ChatGPT
    // payloads can attach non-"all" recipients to normal assistant messages.
    // Keep it as diagnostics only; do not exclude by recipient here.

    // High-confidence final output.
    if(channel==="final" || endTurn) return "assistant_final_high_confidence";

    // Text-like assistant messages remain likely final. Do NOT exclude solely
    // because reasoning_status=is_reasoning; ChatGPT also attaches that metadata
    // to normal text messages in observed conversation payloads.
    if(contentType==="text" || contentType==="multimodal_text" || contentType==="unknown")
      return "assistant_text_candidate";

    return `assistant_other:${contentType}`;
  }
  function includedInHighConfidence(classification){
    return classification==="user" || classification==="assistant_final_high_confidence";
  }
  function includedInLikelyFinal(classification){
    return classification==="user" ||
      classification==="assistant_final_high_confidence" ||
      classification==="assistant_text_candidate";
  }

  function messageFingerprint(text){
    // Fast non-cryptographic fingerprint: lets latest-page refresh skip tokenizer work
    // for messages whose content has not changed. It is not reversible chat storage.
    let h=2166136261;
    for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619);}
    return (h>>>0).toString(16).padStart(8,"0");
  }

  async function addMessages(list,target=state.messages){
    if(!Array.isArray(list))return 0;
    const prepared=[], changed=[];
    list.forEach((msg,i)=>{
      const text=visibleMessageText(msg); if(!text)return;
      const id=String(messageId(msg,i));
      const role=msg?.author?.role??msg?.message?.author?.role??msg?.role??"";
      const fingerprint=messageFingerprint(text);
      const classification=classifyMessage(msg);
      const contentType=messageContentType(msg);
      const existing=target.get(id);
      prepared.push({id,text,role,fingerprint,classification,contentType,recipient:String(msg?.recipient??msg?.message?.recipient??"")});

      // Existing v1.0 caches have no fingerprint. Same ID + same length is safe
      // enough for the migration fast path; the fingerprint is learned now.
      if(existing && Number(existing.chars)===text.length &&
         (!existing.fingerprint || existing.fingerprint===fingerprint)){
        target.set(id,{...existing,role,chars:text.length,fingerprint,text:null,classification,contentType,recipient:String(msg?.recipient??msg?.message?.recipient??"")});
        return;
      }
      changed.push({id,text,role,fingerprint,classification,contentType,recipient:String(msg?.recipient??msg?.message?.recipient??"")});
    });

    const counts=await tokenizerCounts(changed.map(x=>x.text));
    changed.forEach((x,i)=>target.set(x.id,{id:x.id,role:x.role,text:null,chars:x.text.length,tokens:Number(counts[i])||0,fingerprint:x.fingerprint,classification:x.classification,contentType:x.contentType,recipient:x.recipient||""}));
    state.lastTokenizedMessages=changed.length;
    return prepared.length;
  }

  function getStats(){ let chars=0,tokens=0; for(const x of state.messages.values()){chars+=Number(x.chars)||0;tokens+=Number(x.tokens)||0;} return {chars,tokens,count:state.messages.size}; }
  function getClassificationStats(){
    const buckets={};
    let highConfidenceTokens=0, highConfidenceChars=0, highConfidenceCount=0;
    let likelyFinalTokens=0, likelyFinalChars=0, likelyFinalCount=0;
    let unknownCount=0;

    for(const x of state.messages.values()){
      const clsName=x.classification||"unknown";
      if(!buckets[clsName])buckets[clsName]={count:0,tokens:0,chars:0};
      buckets[clsName].count++;
      buckets[clsName].tokens+=Number(x.tokens)||0;
      buckets[clsName].chars+=Number(x.chars)||0;

      if(includedInHighConfidence(clsName)){
        highConfidenceTokens+=Number(x.tokens)||0;
        highConfidenceChars+=Number(x.chars)||0;
        highConfidenceCount++;
      }
      if(includedInLikelyFinal(clsName)){
        likelyFinalTokens+=Number(x.tokens)||0;
        likelyFinalChars+=Number(x.chars)||0;
        likelyFinalCount++;
      }
      if(clsName==="unknown")unknownCount++;
    }

    return {
      buckets,
      highConfidenceTokens, highConfidenceChars, highConfidenceCount,
      likelyFinalTokens, likelyFinalChars, likelyFinalCount,
      unknownCount
    };
  }
  function serializableMeta(){ return [...state.messages.values()].map(x=>({
    id:x.id,role:x.role,chars:Number(x.chars)||0,tokens:Number(x.tokens)||0,
    fingerprint:x.fingerprint||null,classification:x.classification||"unknown",
    contentType:x.contentType||"unknown",recipient:x.recipient||""
  })); }

  async function pruneCacheIndex(){
    const key="jlcm:v05:index"; const result=await storageGet("local",[key]); const index=Array.isArray(result[key])?result[key]:[];
    index.sort((a,b)=>(b.lastAccess||0)-(a.lastAccess||0)); const keep=index.slice(0,MAX_CACHE_CONVERSATIONS), remove=index.slice(MAX_CACHE_CONVERSATIONS);
    if(remove.length)await storageRemove("local",remove.map(x=>cacheKey(x.id))); await storageSet("local",{[key]:keep});
  }
  async function saveCache(id){
    if(!id||state.apiMode==="dom")return; const now=Date.now();
    const payload={schema:CACHE_SCHEMA,updatedAt:now,tokenMethod:state.tokenMethod,tokenizerVerified:state.tokenizerVerified,messages:serializableMeta()};
    await storageSet("local",{[cacheKey(id)]:payload});
    state.preloadedCaches.set(id,payload);
    const ik="jlcm:v05:index", r=await storageGet("local",[ik]); const arr=(Array.isArray(r[ik])?r[ik]:[]).filter(x=>x.id!==id);
    arr.unshift({id,lastAccess:now}); await storageSet("local",{[ik]:arr}); state.cacheUpdatedAt=now; state.cacheLoaded=true; pruneCacheIndex();
  }
  function migrateCachePayload(payload){
    if(!payload||typeof payload!=="object")return null;
    // Accuracy classification requires schema 4 metadata. Older caches are
    // rebuilt once so every message can receive a reliable classification.
    if(payload.schema===5&&Array.isArray(payload.messages))return payload;
    return null;
  }

  function hydrateCachePayload(id,p){
    if(!p)return false;
    const map=new Map();
    for(const x of p.messages){if(!x?.id)continue;map.set(String(x.id),{id:String(x.id),role:x.role||"",text:null,chars:Number(x.chars)||0,tokens:Number(x.tokens)||0,fingerprint:x.fingerprint||null,classification:x.classification||"unknown",contentType:x.contentType||"unknown",recipient:x.recipient||""});}
    state.messages=map;
    state.cacheUpdatedAt=Number(p.updatedAt)||0;
    const compact=p.compact&&typeof p.compact==="object" ? p.compact : getStats();
    instantStats.set(id,{tokens:Number(compact.tokens)||0,count:Number(compact.count)||state.messages.size,chars:Number(compact.chars)||0,updatedAt:state.cacheUpdatedAt});
    state.cacheLoaded=true; state.tokenMethod=p.tokenMethod||"快取"; state.tokenizerVerified=Boolean(p.tokenizerVerified); state.exactTokenCount=state.tokenMethod==="o200k_base"&&state.tokenizerVerified;
    state.source=`⚡ 快取載入（${state.messages.size} 則）`; state.apiMode="cache";
    state.preloadedCaches.set(id,p);
    return true;
  }

  async function preloadRecentCaches(){
    try{
      const ik="jlcm:v05:index", idxResult=await storageGet("local",[ik]);
      const idx=Array.isArray(idxResult[ik])?idxResult[ik].slice(0,MAX_CACHE_CONVERSATIONS):[];
      if(!idx.length)return;
      const keys=idx.map(x=>cacheKey(x.id));
      const all=await storageGet("local",keys);
      for(const x of idx){
        const p=migrateCachePayload(all[cacheKey(x.id)]);
        if(p)state.preloadedCaches.set(String(x.id),p);
      }
    }catch{}
  }

  function showPreloadedConversation(id){
    traceMark("preloaded_show_start");
    const p=state.preloadedCaches.get(id);
    if(!p)return false;
    const epoch=++state.loadEpoch;
    state.loading=false;state.loadingEpoch=epoch;state.conversationId=id;state.initializedConversation=id;state.lastError="";state.tokenizerMs=0;state.tokenizerRunFailed=false;state.lastTokenizedMessages=0;
    hydrateCachePayload(id,p);
    state.lastLoadMs=0;
    updateUI();
    state.lastInstantDisplayMs=Math.max(0,performance.now()-perfTrace.started);
    traceMark("preloaded_show_painted");
    return true;
  }

  async function loadCache(id){
    traceMark("load_cache_start");
    if(!id)return false;
    const preloaded=state.preloadedCaches.get(id);
    if(preloaded){const ok=hydrateCachePayload(id,preloaded);traceMark("load_cache_preloaded_done");return ok;}
    const r=await storageGet("local",[cacheKey(id)]), p=migrateCachePayload(r[cacheKey(id)]);
    const ok=hydrateCachePayload(id,p);traceMark("load_cache_storage_done");return ok;
  }
  function applyInstantStats(id,sourceLabel="⚡ 即時快取"){
    traceMark("instant_stats_start");
    const s=instantStats.get(id);
    if(!s)return false;
    state.conversationId=id;
    state.source=`${sourceLabel}（${s.count||0} 則）`;
    state.apiMode="cache";
    state.cacheLoaded=true;
    state.cacheUpdatedAt=Number(s.updatedAt)||0;
    state.loading=false;
    render();
    state.lastInstantDisplayMs=Math.max(0,performance.now()-perfTrace.started);
    traceMark("instant_stats_painted");
    return true;
  }

  async function clearCurrentCache(){
    const id=extractConversationId(); if(!id)return; await storageRemove("local",[cacheKey(id)]);
    const ik="jlcm:v05:index",r=await storageGet("local",[ik]); await storageSet("local",{[ik]:(Array.isArray(r[ik])?r[ik]:[]).filter(x=>x.id!==id)});
    state.preloadedCaches.delete(id); state.cacheUpdatedAt=0;state.cacheLoaded=false;
  }

  async function prewarmInstantStats(){
    try{
      const ik="jlcm:v05:index";
      const r=await storageGet("local",[ik]);
      const index=Array.isArray(r[ik])?r[ik].slice(0,MAX_CACHE_CONVERSATIONS):[];
      if(!index.length)return;
      const keys=index.map(x=>cacheKey(x.id));
      const all=await storageGet("local",keys);
      for(const row of index){
        const p=migrateCachePayload(all[cacheKey(row.id)]);
        if(!p)continue;
        if(p.compact&&typeof p.compact==="object"){
          instantStats.set(row.id,{
            tokens:Number(p.compact.tokens)||0,
            count:Number(p.compact.count)||0,
            chars:Number(p.compact.chars)||0,
            updatedAt:Number(p.compact.updatedAt)||Number(p.updatedAt)||0
          });
        }else if(Array.isArray(p.messages)){
          let tokens=0,chars=0;
          for(const x of p.messages){tokens+=Number(x.tokens)||0;chars+=Number(x.chars)||0;}
          instantStats.set(row.id,{tokens,count:p.messages.length,chars,updatedAt:Number(p.updatedAt)||0});
        }
      }
    }catch{}
  }

  async function getAccessToken(){try{const r=await fetch(`${location.origin}/api/auth/session`,{method:"GET",credentials:"include",cache:"no-store"});if(!r.ok)return null;const d=await r.json();return d?.accessToken||d?.access_token||null;}catch{return null;}}
  async function authedJson(url,token){const h={accept:"application/json"};if(token)h.authorization=`Bearer ${token}`;const r=await fetch(url,{method:"GET",credentials:"include",cache:"no-store",headers:h});if(!r.ok){const e=new Error(`HTTP ${r.status}`);e.status=r.status;throw e;}return r.json();}
  async function fetchNewApiPage(id,token,before=null){const u=new URL(`/backend-api/conversations/${encodeURIComponent(id)}`,location.origin);u.searchParams.set("include_has_versions","true");u.searchParams.set("num_turns","100");if(before)u.searchParams.set("before",before);return authedJson(u.toString(),token);}

  async function fullScanNewApi(id,token,target){
    let before=null,page=0; const seen=new Set();
    while(page<100){const d=await fetchNewApiPage(id,token,before);await addMessages(d?.messages||d?.items||[],target);const info=d?.page_info||d?.pageInfo||{};const has=info?.has_previous_page??info?.hasPreviousPage??false;const cur=info?.start_cursor??info?.startCursor??null;page++;if(!has||!cur||seen.has(cur))break;seen.add(cur);before=cur;}
    return {pages:page,messages:target.size};
  }
  async function latestOnlyNewApi(id,token,target=state.messages){traceMark("latest_api_start");const d=await fetchNewApiPage(id,token,null);traceMark("latest_api_response");await addMessages(d?.messages||d?.items||[],target);traceMark("latest_api_parsed");return {messages:target.size};}
  async function fullScanLegacyApi(id,token,target){
    const d=await authedJson(`${location.origin}/backend-api/conversation/${encodeURIComponent(id)}`,token), mapping=d?.mapping;
    if(!mapping||typeof mapping!=="object")throw new Error("Legacy API 沒有 mapping"); const list=[];
    for(const node of Object.values(mapping))if(node?.message)list.push(node.message); await addMessages(list,target); return {messages:target.size};
  }
  async function collectDomFallback(){
    const nodes=[...document.querySelectorAll('[data-message-author-role="user"], [data-message-author-role="assistant"]')], prepared=[];
    nodes.forEach((node,i)=>{if(node.closest(`#${ROOT_ID}`))return;const text=(node.innerText||node.textContent||"").trim();if(!text)return;const role=node.getAttribute("data-message-author-role")||"unknown";const id=node.getAttribute("data-message-id")||node.closest("[data-message-id]")?.getAttribute("data-message-id")||`dom:${role}:${i}:${text.slice(0,80)}`;prepared.push({id,text,role});});
    const counts=await tokenizerCounts(prepared.map(x=>x.text)); const map=new Map(); prepared.forEach((x,i)=>map.set(x.id,{id:x.id,role:x.role,text:null,chars:x.text.length,tokens:Number(counts[i])||0})); return map;
  }

  function resetTokenizerRun(){state.tokenizerMs=0;state.tokenizerRunFailed=false;if(!state.cacheLoaded){state.tokenMethod="等待 Tokenizer";state.tokenizerVerified=false;state.exactTokenCount=false;}}

  async function fullRefresh(epoch=state.loadEpoch,id=extractConversationId()){
    if(state.loading&&state.loadingEpoch===epoch)return;
    const started=performance.now(),working=new Map(); state.conversationId=id; state.loading=true; state.loadingEpoch=epoch; state.lastError=""; resetTokenizerRun(); state.source="完整歷史：讀取中…"; updateUI();
    try{
      if(!id){const dom=await collectDomFallback();if(epoch!==state.loadEpoch)return;state.messages=dom;state.source="⚠️ DOM（目前畫面）";state.apiMode="dom";state.lastError="目前網址沒有可辨識的對話 ID";return;}
      const token=await getAccessToken();
      try{const r=await fullScanNewApi(id,token,working);if(epoch!==state.loadEpoch||id!==extractConversationId())return;state.messages=working;state.source=`✅ 完整歷史（${r.pages} 頁 / ${r.messages} 則）`;state.apiMode="paged";state.initializedConversation=id;}
      catch(e1){working.clear();const r=await fullScanLegacyApi(id,token,working);if(epoch!==state.loadEpoch||id!==extractConversationId())return;state.messages=working;state.source=`✅ 完整歷史 Legacy（${r.messages} 則）`;state.apiMode="legacy";state.initializedConversation=id;}
      await saveCache(id);
    }catch(err){const dom=await collectDomFallback();if(epoch!==state.loadEpoch||id!==extractConversationId())return;state.messages=dom;state.source="⚠️ DOM fallback（僅目前載入）";state.apiMode="dom";state.lastError=err?.message||String(err);}
    finally{if(epoch===state.loadEpoch){state.loading=false;state.lastLatestRefresh=Date.now();state.lastLoadMs=performance.now()-started;updateUI();}}
  }

  async function refreshLatestOnly(force=false,epoch=state.loadEpoch){
    const id=extractConversationId();
    if(!id)return;
    if(state.latestRefreshInFlight&&state.latestRefreshId===id){
      traceMark("refresh_latest_skip","inflight");
      return;
    }
    if(state.initializedConversation!==id&&!state.cacheLoaded){
      traceMark("refresh_latest_full_needed");
      await fullRefresh(epoch,id);
      return;
    }
    if(!force&&Date.now()-state.lastLatestRefresh<LATEST_THROTTLE_MS){
      traceMark("refresh_latest_skip","throttled");
      return;
    }

    traceMark("refresh_latest_enter");
    const started=performance.now(),target=state.messages;
    state.latestRefreshInFlight=true;
    state.latestRefreshId=id;
    state.lastError="";
    state.tokenizerMs=0;
    state.lastTokenizedMessages=0;
    traceMark("refresh_latest_start");

    try{
      const token=await getAccessToken();
      await latestOnlyNewApi(id,token,target);
      if(epoch!==state.loadEpoch||id!==extractConversationId())return;
      state.source=`⚡ 快取命中 + 最新頁（${state.messages.size} 則）`;
      state.apiMode="paged-cache";
      state.initializedConversation=id;
      await saveCache(id);
    }
    catch(err){
      if(epoch===state.loadEpoch&&id===extractConversationId())
        state.lastError=`最新頁更新失敗：${err?.message||String(err)}`;
    }
    finally{
      if(state.latestRefreshId===id){
        state.latestRefreshInFlight=false;
        state.latestRefreshId=null;
      }
      if(epoch===state.loadEpoch&&id===extractConversationId()){
        state.lastLatestRefresh=Date.now();
        state.lastBackgroundSyncMs=performance.now()-started;
        updateUI();
        traceMark("refresh_latest_painted");
      }
    }
  }

  async function loadConversationSmart(){
    const epoch=++state.loadEpoch,started=performance.now(),id=extractConversationId();
    traceMark("route_load_start",id?"id":"no-id");
    state.lastBackgroundSyncMs=0;
    state.loading=false;state.loadingEpoch=epoch;state.conversationId=id;state.messages=new Map();state.cacheLoaded=false;state.cacheUpdatedAt=0;state.initializedConversation=null;state.lastError="";state.tokenizerMs=0;state.tokenizerRunFailed=false;state.lastTokenizedMessages=0;
    if(!id){state.messages=await collectDomFallback();if(epoch!==state.loadEpoch)return;state.source="⚠️ DOM（目前畫面）";state.apiMode="dom";state.lastLoadMs=performance.now()-started;updateUI();return;}
    const has=await loadCache(id);traceMark("route_cache_result",has?"hit":"miss");if(epoch!==state.loadEpoch)return;if(has){
      state.lastLoadMs=performance.now()-started;
      if(!state.lastInstantDisplayMs)state.lastInstantDisplayMs=state.lastLoadMs;
      updateUI();
      traceMark("route_cache_painted");
    }
    const fresh=has&&(Date.now()-state.cacheUpdatedAt<CACHE_TTL_MS)&&state.exactTokenCount;
    if(fresh){
      state.initializedConversation=id;
      // Paint cached percentage first, then reconcile only the newest page.
      setTimeout(()=>{traceMark("latest_delay_fire");if(epoch===state.loadEpoch&&id===extractConversationId())refreshLatestOnly(true,epoch);},60);
      return;
    }
    await fullRefresh(epoch,id);
  }

  function statusFor(pct){if(pct>=85)return["建議換新視窗","danger"];if(pct>=75)return["建議準備換視窗","handoff"];if(pct>=60)return["對話偏長","warn"];return["正常","ok"];} 
  function tokenizerLabel(){if(state.tokenMethod==="o200k_base")return state.tokenizerVerified?"o200k_base ✓":"o200k_base";return state.tokenMethod;}
  function buildDiagnostics(){
    const s=getStats(),limit=getContextLimit(),pct=limit?Math.round((s.tokens/limit)*1000)/10:0;
    const classStats=getClassificationStats();
    const highPct=limit?Math.round((classStats.highConfidenceTokens/limit)*1000)/10:0;
    const likelyPct=limit?Math.round((classStats.likelyFinalTokens/limit)*1000)/10:0;
    const specialTokens=Math.max(0,s.tokens-classStats.likelyFinalTokens);
    const specialPct=s.tokens?Math.round((specialTokens/s.tokens)*1000)/10:0;
    const bucketLines=Object.entries(classStats.buckets)
      .sort((a,b)=>b[1].tokens-a[1].tokens)
      .map(([k,v])=>`classification_${k}=${v.count} msgs / ${v.tokens} tokens`);
    const recipientBuckets={};
    for(const x of state.messages.values()){
      const rk=x.recipient||"(empty)";
      if(!recipientBuckets[rk])recipientBuckets[rk]={count:0,tokens:0};
      recipientBuckets[rk].count++;
      recipientBuckets[rk].tokens+=Number(x.tokens)||0;
    }
    const recipientLines=Object.entries(recipientBuckets)
      .sort((a,b)=>b[1].tokens-a[1].tokens)
      .slice(0,12)
      .map(([k,v])=>`recipient_${k}=${v.count} msgs / ${v.tokens} tokens`);
    return [
      `ChatGPT Context Meter ${EXT_VERSION}`,`host=${location.host}`,`conversation_id_present=${Boolean(extractConversationId())}`,
      `source=${state.source}`,`api_mode=${state.apiMode}`,`messages=${s.count}`,`chars=${s.chars}`,`history_tokens=${s.tokens}`,
      `high_confidence_final_tokens=${classStats.highConfidenceTokens}`,`high_confidence_ratio_pct=${highPct}`,
      `likely_final_text_tokens=${classStats.likelyFinalTokens}`,`likely_final_ratio_pct=${likelyPct}`,
      `special_intermediate_tokens=${specialTokens}`,`special_intermediate_pct=${specialPct}`,
      `classification_unknown=${classStats.unknownCount}`,...bucketLines,...recipientLines,
      `context_reference=${limit}`,`history_ratio_pct=${pct}`,`token_method=${state.tokenMethod}`,`tokenizer_verified=${state.tokenizerVerified}`,
      `tokenizer_vocab_origin=${state.tokenizerOrigin}`,`tokenizer_ms=${Math.round(state.tokenizerMs||0)}`,`display_ms=${Math.round(state.lastInstantDisplayMs||state.lastLoadMs||0)}`,`background_sync_ms=${Math.round(state.lastBackgroundSyncMs||0)}`,`load_ms=${Math.round(state.lastLoadMs||0)}`,
      `cache=${state.cacheLoaded?"yes":"no"}`,`cache_age=${formatAge(state.cacheUpdatedAt)}`,`incremental_tokenized=${state.lastTokenizedMessages}`,`perf_trace=${traceText()}`,
      `last_error=${state.lastError||"none"}`
    ].join("\n");
  }
  async function copyDiagnostics(){const text=buildDiagnostics();try{await navigator.clipboard.writeText(text);}catch{const ta=document.createElement("textarea");ta.value=text;ta.style.position="fixed";ta.style.opacity="0";document.body.appendChild(ta);ta.select();document.execCommand("copy");ta.remove();}state.copiedAt=Date.now();updateUI();setTimeout(updateUI,1600);}

  function simpleSourceLabel(){
    if(state.loading)return "正在讀取完整對話…";
    if(state.apiMode==="dom")return "⚠ 僅讀取部分內容｜數字可能偏低";
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
        <div class="jlcm-breakdown" aria-label="Context 組成">
          <div><span class="jlcm-breakdown-label">對話正文</span><span class="jlcm-breakdown-text">--</span></div>
          <div><span class="jlcm-breakdown-label">工具歷史</span><span class="jlcm-breakdown-tool">--</span></div>
        </div>
        <div class="jlcm-simple-source">等待讀取</div>
        <div class="jlcm-error-simple" hidden></div>
        <div class="jlcm-first-use" hidden>
          <strong>第一次使用</strong>
          <p>這個百分比是長對話參考值，不是 OpenAI 官方 Context 使用率。付費版預設 272k；Free / Go 可從齒輪調整。</p>
          <button class="jlcm-first-use-ok" type="button">知道了</button>
        </div>
        <details class="jlcm-about">
          <summary>這個數字怎麼算？</summary>
          <p>以完整可讀的對話歷史 Token（對話正文＋工具歷史），除以設定的 Context 參考值。這是長對話負載參考指標，不是 OpenAI 官方或實際 Context 使用率。</p>
        </details>
        <section class="jlcm-settings-panel" hidden>
          <div class="jlcm-settings-title">設定</div>
          <label>使用情境
            <select class="jlcm-profile">
              <option value="paid">ChatGPT 付費版 — 272k（建議）</option>
              <option value="freego">ChatGPT Free / Go — 128k</option>
              <option value="advanced">進階／自訂</option>
            </select>
          </label>
          <label class="jlcm-advanced-row">進階參考值
            <select class="jlcm-preset"><option value="1m">1.05M Token</option><option value="custom">自訂</option></select>
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
    root.querySelector(".jlcm-profile").addEventListener("change",updateProfileVisibility);
    root.querySelector(".jlcm-first-use-ok").addEventListener("click",dismissOnboarding);
    root.querySelector(".jlcm-preset").addEventListener("change",updateProfileVisibility);
    root.querySelector(".jlcm-save").addEventListener("click",()=>{
      const profile=root.querySelector(".jlcm-profile").value;
      const contextPreset=profile==="paid"?"272k":profile==="freego"?"128k":root.querySelector(".jlcm-preset").value;
      const customContextTokens=Math.max(10000,Number(root.querySelector(".jlcm-custom-input").value)||272000);
      state.config={...state.config,contextPreset,customContextTokens,warnPct:60,handoffPct:75,dangerPct:85};
      saveSettings();syncInputs();updateUI();settings.hidden=true;
    });
  }
  function updateProfileVisibility(){
    const r=document.getElementById(ROOT_ID);if(!r)return;
    const profile=r.querySelector(".jlcm-profile").value;
    const advanced=r.querySelector(".jlcm-advanced-row"),custom=r.querySelector(".jlcm-custom-row");
    if(advanced)advanced.style.display=profile==="advanced"?"grid":"none";
    if(custom)custom.style.display=profile==="advanced"&&r.querySelector(".jlcm-preset").value==="custom"?"grid":"none";
  }
  function syncInputs(){
    const r=document.getElementById(ROOT_ID);if(!r)return;
    const preset=state.config.contextPreset;
    r.querySelector(".jlcm-profile").value=preset==="272k"?"paid":preset==="128k"?"freego":"advanced";
    r.querySelector(".jlcm-preset").value=(preset==="1m"||preset==="custom")?preset:"1m";
    r.querySelector(".jlcm-custom-input").value=state.config.customContextTokens;
    updateProfileVisibility();
  }
  function updateUI(){
    ensureUI();const r=document.getElementById(ROOT_ID);if(!r)return;
    const s=getStats(),limit=getContextLimit(),pctRaw=limit?(s.tokens/limit)*100:0,pct=Math.max(0,Math.round(pctRaw)),pctDetail=Math.max(0,Math.round(pctRaw*10)/10),bar=Math.max(0,Math.min(100,pctRaw)),[label,cls]=statusFor(pctRaw);
    r.dataset.status=cls;
    r.querySelector(".jlcm-pct").textContent=state.loading?"…":`${pct}%`;
    r.querySelector(".jlcm-big-pct").textContent=state.loading?"…":`${pctDetail.toFixed(1)}%`;
    r.querySelector(".jlcm-status").textContent=state.loading?"讀取中":label;
    const prefix=state.exactTokenCount?"":"約 ";
    r.querySelector(".jlcm-primary-token").textContent=`${prefix}${formatNumber(s.tokens)} / ${formatNumber(limit)} Token`;
    const classStatsUi=getClassificationStats();
    const textTokensUi=classStatsUi.likelyFinalTokens;
    const toolTokensUi=Math.max(0,s.tokens-textTokensUi);
    const textPctUi=limit?Math.round(textTokensUi/limit*1000)/10:0;
    const toolPctUi=limit?Math.round(toolTokensUi/limit*1000)/10:0;
    const breakdownText=r.querySelector(".jlcm-breakdown-text");
    const breakdownTool=r.querySelector(".jlcm-breakdown-tool");
    if(breakdownText)breakdownText.textContent=state.loading?"…":`${formatNumber(textTokensUi)} · ${textPctUi.toFixed(1)}%`;
    if(breakdownTool)breakdownTool.textContent=state.loading?"…":`${formatNumber(toolTokensUi)} · ${toolPctUi.toFixed(1)}%`;
    r.querySelector(".jlcm-simple-source").textContent=simpleSourceLabel();
    r.querySelector(".jlcm-source").textContent=state.source;
    r.querySelector(".jlcm-token-method").textContent=tokenizerLabel();
    r.querySelector(".jlcm-bar-fill").style.width=`${bar}%`;
    const e=r.querySelector(".jlcm-error-simple");
    if(state.apiMode==="dom"){
      e.hidden=false;
      e.textContent="⚠ 目前只能估算畫面中已載入的內容，百分比可能明顯偏低。請稍後按 ↻ 重試。";
    }else if(state.tokenizerRunFailed){
      e.hidden=false;
      e.textContent="⚠ Tokenizer 暫時改用本機粗估，百分比可能有少量誤差。可稍後按 ↻ 重試。";
    }else if(state.lastError){
      e.hidden=false;
      e.textContent="⚠ 最新資料更新失敗，目前先顯示已讀取的結果。可稍後按 ↻ 重試。";
    }else{
      e.hidden=true;e.textContent="";
    }

    const first=r.querySelector(".jlcm-first-use");
    if(first) first.hidden=!state.onboardingVisible;
    r.querySelector(".jlcm-copy-status").textContent=Date.now()-state.copiedAt<1500?"已複製（不含對話內容與對話 ID）":"";
  }
  async function init(){
    await initSettings();
    await prewarmInstantStats();
    ensureUI();
    syncInputs();
    const root=document.getElementById(ROOT_ID);
    if(state.onboardingVisible&&root){
      const panel=root.querySelector(".jlcm-panel");
      if(panel)panel.hidden=false;
    }
    updateUI();
    // Warm recent conversation caches once so sidebar switching can paint synchronously.
    const preloadPromise=preloadRecentCaches();
    await loadConversationSmart();
    preloadPromise.catch(()=>{});

    // Predict ChatGPT sidebar navigation at pointer-down time. This paints the
    // destination conversation from RAM before the SPA route itself finishes.
    document.addEventListener("pointerdown",event=>{
      const a=event.target?.closest?.('a[href*="/c/"]');
      if(!a)return;
      try{
        const u=new URL(a.href,location.href),m=u.pathname.match(/\/c\/([^/?#]+)/i);
        const id=m?.[1];
        if(id&&id!==extractConversationId()){
          traceReset(id,"pointerdown");
          traceMark("sidebar_target_found");
          if(!showPreloadedConversation(id))applyInstantStats(id,"⚡ 即時快取");
        }
      }catch{}
    },true);

    const onRouteChange=()=>{
      if(location.href===state.lastUrl)return;
      state.lastUrl=location.href;
      traceMark("route_changed");
      loadConversationSmart();
    };
    // Chromium Navigation API gives near-immediate SPA route notifications.
    // Keep popstate/hashchange + a lightweight poll as compatibility fallbacks.
    try{if(window.navigation)window.navigation.addEventListener("navigatesuccess",onRouteChange);}catch{}
    window.addEventListener("popstate",onRouteChange);
    window.addEventListener("hashchange",onRouteChange);
    setInterval(onRouteChange,ROUTE_POLL_MS);
    let debounce=null;
    const ob=new MutationObserver(()=>{
      clearTimeout(debounce);
      if(state.latestRefreshInFlight)return;
      if(Date.now()-state.lastLatestRefresh<LATEST_THROTTLE_MS)return;
      debounce=setTimeout(()=>{
        if(state.latestRefreshInFlight)return;
        if(Date.now()-state.lastLatestRefresh<LATEST_THROTTLE_MS)return;
        refreshLatestOnly(false);
      },2500);
    });
    ob.observe(document.documentElement,{subtree:true,childList:true,characterData:true});
  }
  init();


})();
