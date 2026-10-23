/**
 * Minimal Bilibili read client used when the user stored a login cookie.
 *
 * Why this exists: the generic search channels cannot answer "what did this
 * creator publish last" — Bing mangles Chinese product names and Tavily returns
 * encyclopedia pages. The space API answers it exactly, but it rejects requests
 * without a browser-shaped header set (HTTP 412) and the AI summary endpoint
 * additionally requires a logged-in cookie.
 *
 * Only read endpoints are used; nothing here posts, likes or mutates an account.
 *
 * @module dsh-search-contrl/bilibili-api
 */
import crypto from 'node:crypto';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/** The reorder table Bilibili uses to derive the WBI mixin key. */
export const MIXIN_KEY_TABLE = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
  37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
  22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
];

/** Build the 32-char mixin key from the two filenames `nav` returns. */
export function mixinKey(imgKey, subKey) {
  const raw = `${imgKey}${subKey}`;
  let out = '';
  for (let index = 0; index < 32; index += 1) {
    out += raw[MIXIN_KEY_TABLE[index]] ?? '';
  }
  return out;
}

/** Extract the bare key from a `wbi_img` URL (`.../7cd084941338484aae1ad9425b84077c.png`). */
export function keyFromUrl(url) {
  const name = String(url ?? '').split('/').pop() ?? '';
  return name.split('.')[0] ?? '';
}

const md5 = value => crypto.createHash('md5').update(value).digest('hex');

const needsEscape = /[!'()*]/g;

function encodeValue(value) {
  return encodeURIComponent(String(value)).replace(needsEscape, '');
}

/**
 * Sign a query the way `x/space/wbi/arc/search` expects.
 * Returns the full query string including `wts` and `w_rid`.
 */
export function signWbi(params, key, { now = Math.floor(Date.now() / 1000) } = {}) {
  const withWts = { ...params, wts: now };
  const query = Object.keys(withWts)
    .sort()
    .map(name => `${encodeValue(name)}=${encodeValue(withWts[name])}`)
    .join('&');
  return `${query}&w_rid=${md5(query + key)}`;
}

function browserHeaders(referer) {
  return {
    'user-agent': UA,
    accept: 'application/json, text/plain, */*',
    'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
    origin: 'https://space.bilibili.com',
    referer,
    'sec-fetch-site': 'same-site',
    'sec-fetch-mode': 'cors',
    'sec-fetch-dest': 'empty',
  };
}

/** Create a client bound to one cookie header (or '' for anonymous reads). */
export function createBilibiliClient({ cookie = '', fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('bilibili client needs fetch');

  const headers = referer => (cookie ? { ...browserHeaders(referer), cookie } : browserHeaders(referer));

  async function getJson(url, referer) {
    const response = await fetchImpl(url, { headers: headers(referer), redirect: 'follow' });
    if (!response?.ok) {
      throw new Error(`bilibili http ${response?.status ?? 'no response'} for ${url}`);
    }
    const payload = await response.json();
    if (payload?.code !== 0) {
      throw new Error(`bilibili api ${payload?.code ?? 'unknown'}: ${payload?.message ?? 'no message'}`);
    }
    return payload.data;
  }

  /** Latest uploads of a creator, newest first. */
  async function latestVideos(mid, { ps = 10, pn = 1 } = {}) {
    const numericMid = String(mid).replace(/[^0-9]/g, '');
    if (!numericMid) throw new Error('bilibili mid must be numeric');
    const url = `https://api.bilibili.com/x/space/arc/search?mid=${numericMid}&ps=${ps}&pn=${pn}&order=pubdate`;
    const data = await getJson(url, `https://space.bilibili.com/${numericMid}/video`);
    const list = data?.list?.vlist ?? [];
    return list.map(item => ({
      bvid: item.bvid,
      title: item.title,
      publishedAt: item.created ? new Date(item.created * 1000).toISOString() : null,
      duration: typeof item.length === 'string' ? item.length : `${item.length ?? 0}`,
      views: item.play ?? 0,
      comments: item.comment ?? 0,
      description: item.description ?? '',
      url: `https://www.bilibili.com/video/${item.bvid}/`,
    }));
  }

  /** Full metadata for one video (title, description, stats, cid). */
  async function videoView(bvid) {
    const data = await getJson(`https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`, 'https://www.bilibili.com/');
    return {
      bvid: data.bvid,
      aid: data.aid,
      cid: data.cid,
      mid: data.owner?.mid ?? null,
      title: data.title,
      description: data.desc ?? '',
      publishedAt: data.pubdate ? new Date(data.pubdate * 1000).toISOString() : null,
      duration: data.duration ?? 0,
      tags: (data.tags ?? []).map(tag => tag.tag_name).filter(Boolean),
      stats: {
        views: data.stat?.view ?? 0,
        likes: data.stat?.like ?? 0,
        coins: data.stat?.coin ?? 0,
        favorites: data.stat?.favorite ?? 0,
        shares: data.stat?.share ?? 0,
        comments: data.stat?.reply ?? 0,
        danmaku: data.stat?.danmaku ?? 0,
      },
      url: `https://www.bilibili.com/video/${data.bvid}/`,
    };
  }

  /** WBI keys from `nav` (works even when not logged in). */
  async function wbiKeys() {
    const response = await fetchImpl('https://api.bilibili.com/x/web-interface/nav', { headers: headers('https://www.bilibili.com/') });
    if (!response?.ok) throw new Error(`bilibili nav http ${response?.status ?? 'no response'}`);
    const payload = await response.json();
    const img = keyFromUrl(payload?.data?.wbi_img?.img_url);
    const sub = keyFromUrl(payload?.data?.wbi_img?.sub_url);
    if (!img || !sub) throw new Error('bilibili nav did not return wbi keys');
    return { key: mixinKey(img, sub), loggedIn: Boolean(payload?.data?.isLogin) };
  }

  /** The platform's own AI summary for a video; needs a logged-in cookie. */
  async function aiConclusion(bvid, cid, mid) {
    const { key, loggedIn } = await wbiKeys();
    if (!loggedIn) {
      return { ok: false, reason: 'not-logged-in', message: '平台 AI 总结需要登录 Cookie' };
    }
    const query = signWbi({ bvid, cid, up_mid: mid ?? '' }, key);
    const url = `https://api.bilibili.com/x/web-interface/view/conclusion/get?${query}`;
    const response = await fetchImpl(url, { headers: headers(`https://www.bilibili.com/video/${bvid}/`) });
    if (!response?.ok) return { ok: false, reason: 'http', message: `AI 总结接口 HTTP ${response?.status}` };
    const payload = await response.json();
    if (payload?.code !== 0) return { ok: false, reason: `api-${payload?.code}`, message: payload?.message ?? 'AI 总结不可用' };
    const model = payload?.data?.model_result ?? {};
    return {
      ok: true,
      summary: model.summary ?? '',
      outline: (model.outline ?? []).map(item => ({ title: item.title, parts: (item.part_outline ?? []).map(part => part.content) })),
    };
  }

  return { latestVideos, videoView, wbiKeys, aiConclusion, hasCookie: cookie !== '' };
}
