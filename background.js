const O200K_URL = "https://openaipublic.blob.core.windows.net/encodings/o200k_base.tiktoken";
const O200K_SHA256 = "446a9538cb6c348e3516120d7c08b09f57c36495e2acfffe59a5bf8b0cfb1a2d";
const O200K_MERGEABLE_RANKS = 199998;
const VOCAB_CACHE = "jlcm-o200k-base-v1";

let rankMapPromise = null;
let vocabularyOrigin = "unknown";
let vocabularyLoadMs = 0;

const CONTRACTION = "(?:'[sS]|'[tT]|'[rR][eE]|'[vV][eE]|'[mM]|'[lL][lL]|'[dD])?";
const PRETOKEN_RE = new RegExp([
  `[^\\r\\n\\p{L}\\p{N}]?[\\p{Lu}\\p{Lt}\\p{Lm}\\p{Lo}\\p{M}]*[\\p{Ll}\\p{Lm}\\p{Lo}\\p{M}]+${CONTRACTION}`,
  `[^\\r\\n\\p{L}\\p{N}]?[\\p{Lu}\\p{Lt}\\p{Lm}\\p{Lo}\\p{M}]+[\\p{Ll}\\p{Lm}\\p{Lo}\\p{M}]*${CONTRACTION}`,
  `\\p{N}{1,3}`,
  ` ?[^\\s\\p{L}\\p{N}]+[\\r\\n/]*`,
  `\\s*[\\r\\n]+`,
  `\\s+(?!\\S)`,
  `\\s+`
].join("|"), "gu");

function hex(buffer) {
  return [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function verifiedVocabBuffer() {
  const started = performance.now();
  const cache = await caches.open(VOCAB_CACHE);
  let response = await cache.match(O200K_URL);
  let source = "cache";

  if (!response) {
    source = "OpenAI";
    response = await fetch(O200K_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`Tokenizer vocabulary HTTP ${response.status}`);
  }

  let buffer = await response.arrayBuffer();
  let digest = hex(await crypto.subtle.digest("SHA-256", buffer));

  if (digest !== O200K_SHA256 && source === "cache") {
    await cache.delete(O200K_URL);
    const fresh = await fetch(O200K_URL, { cache: "no-store" });
    if (!fresh.ok) throw new Error(`Tokenizer vocabulary HTTP ${fresh.status}`);
    buffer = await fresh.arrayBuffer();
    digest = hex(await crypto.subtle.digest("SHA-256", buffer));
    source = "OpenAI";
  }

  if (digest !== O200K_SHA256) {
    throw new Error("o200k_base vocabulary SHA-256 驗證失敗");
  }

  if (source === "OpenAI") {
    await cache.put(O200K_URL, new Response(buffer, {
      headers: { "content-type": "text/plain; charset=utf-8" }
    }));
  }

  vocabularyOrigin = source;
  vocabularyLoadMs = Math.round(performance.now() - started);
  return buffer;
}

async function loadRankMap() {
  if (rankMapPromise) return rankMapPromise;
  rankMapPromise = (async () => {
    const buffer = await verifiedVocabBuffer();
    const text = new TextDecoder().decode(buffer);
    const ranks = new Map();
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const sp = line.lastIndexOf(" ");
      if (sp <= 0) throw new Error(`o200k_base vocabulary 第 ${i + 1} 行格式錯誤`);

      const tokenB64 = line.slice(0, sp).trim();
      const rankText = line.slice(sp + 1).trim();
      const rank = Number(rankText);
      if (!Number.isInteger(rank) || rank < 0) {
        throw new Error(`o200k_base vocabulary 第 ${i + 1} 行 rank 無效`);
      }

      let normalized = tokenB64.replace(/-/g, "+").replace(/_/g, "/");
      const remainder = normalized.length % 4;
      if (remainder) normalized += "=".repeat(4 - remainder);
      try {
        ranks.set(atob(normalized), rank);
      } catch {
        throw new Error(`o200k_base vocabulary 第 ${i + 1} 行 Base64 無效`);
      }
    }
    if (ranks.size !== O200K_MERGEABLE_RANKS) {
      throw new Error(`o200k_base vocabulary 不完整（${ranks.size}/${O200K_MERGEABLE_RANKS}）`);
    }
    return ranks;
  })().catch(err => {
    rankMapPromise = null;
    throw err;
  });
  return rankMapPromise;
}

class MinHeap {
  constructor() { this.a = []; }
  less(x, y) { return x.rank !== y.rank ? x.rank < y.rank : x.leftIndex < y.leftIndex; }
  push(x) {
    const a = this.a; a.push(x); let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(a[i], a[p])) break;
      [a[i], a[p]] = [a[p], a[i]]; i = p;
    }
  }
  pop() {
    const a = this.a;
    if (!a.length) return null;
    const root = a[0], last = a.pop();
    if (a.length) {
      a[0] = last; let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        if (l >= a.length) break;
        let m = l;
        if (r < a.length && this.less(a[r], a[l])) m = r;
        if (!this.less(a[m], a[i])) break;
        [a[i], a[m]] = [a[m], a[i]]; i = m;
      }
    }
    return root;
  }
  get size() { return this.a.length; }
}

function rankOfPair(ranks, left, right) {
  return ranks.get(left.piece + right.piece);
}

function pushPair(heap, ranks, left, right) {
  if (!left || !right || !left.alive || !right.alive || left.next !== right) return;
  const rank = rankOfPair(ranks, left, right);
  if (rank === undefined) return;
  heap.push({
    rank,
    left,
    right,
    leftVersion: left.version,
    rightVersion: right.version,
    leftIndex: left.index
  });
}

function bpeCountPiece(piece, ranks) {
  const bytes = new TextEncoder().encode(piece);
  if (!bytes.length) return 0;

  let whole = "";
  for (let i = 0; i < bytes.length; i++) whole += String.fromCharCode(bytes[i]);
  if (ranks.has(whole)) return 1;
  if (bytes.length === 1) return 1;

  const nodes = new Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    nodes[i] = {
      piece: String.fromCharCode(bytes[i]),
      prev: null, next: null, alive: true, version: 0, index: i
    };
    if (i) { nodes[i - 1].next = nodes[i]; nodes[i].prev = nodes[i - 1]; }
  }

  const heap = new MinHeap();
  for (let i = 0; i + 1 < nodes.length; i++) pushPair(heap, ranks, nodes[i], nodes[i + 1]);

  let count = nodes.length;
  while (heap.size) {
    const item = heap.pop();
    const left = item.left, right = item.right;
    if (!left.alive || !right.alive || left.next !== right ||
        left.version !== item.leftVersion || right.version !== item.rightVersion) continue;

    left.piece += right.piece;
    left.version++;
    right.alive = false;
    right.version++;
    left.next = right.next;
    if (right.next) right.next.prev = left;
    count--;

    pushPair(heap, ranks, left.prev, left);
    pushPair(heap, ranks, left, left.next);
  }
  return count;
}

function countText(text, ranks) {
  if (!text) return 0;
  let total = 0, cursor = 0;
  PRETOKEN_RE.lastIndex = 0;
  for (const match of text.matchAll(PRETOKEN_RE)) {
    const index = match.index ?? cursor;
    if (index > cursor) total += bpeCountPiece(text.slice(cursor, index), ranks);
    total += bpeCountPiece(match[0], ranks);
    cursor = index + match[0].length;
  }
  if (cursor < text.length) total += bpeCountPiece(text.slice(cursor), ranks);
  return total;
}

async function tokenizeTexts(texts) {
  const started = performance.now();
  const ranks = await loadRankMap();
  const counts = texts.map(t => countText(String(t ?? ""), ranks));
  return {
    ok: true,
    counts,
    method: "o200k_base",
    verified: true,
    vocabularyOrigin,
    vocabularyLoadMs,
    tokenizeMs: Math.round(performance.now() - started)
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "JLCM_TOKENIZE_O200K") {
    tokenizeTexts(Array.isArray(message.texts) ? message.texts : [])
      .then(sendResponse)
      .catch(err => sendResponse({ ok: false, error: err?.message || String(err) }));
    return true;
  }
  if (message?.type === "JLCM_TOKENIZER_STATUS") {
    sendResponse({
      ok: true,
      loaded: Boolean(rankMapPromise),
      method: "o200k_base",
      vocabularyOrigin,
      vocabularyLoadMs
    });
  }
});
