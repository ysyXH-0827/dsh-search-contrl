window.__ModuleLoader__.load({
  id: "dsh-search-contrl",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    const react = require("react");
    const react_jsx_runtime = require("react/jsx-runtime");

    const BRIDGE_PREFIX = "/api/search-contrl-settings";

    // jsx(type, props, ...children) — the bundle is compiled without JSX support,
    // so every element is built by hand through the runtime factory.
    const h = (type, props, ...children) => {
      const next = props ? { ...props } : {};
      if (children.length === 1) next.children = children[0];
      else if (children.length > 1) next.children = children;
      return react_jsx_runtime.jsx(type, next);
    };

    //#region css
    const CSS = [
      ".tdr-card{font-family:-apple-system,\"SF Pro Text\",\"PingFang SC\",\"Segoe UI\",system-ui,sans-serif;border:1px solid rgba(0,0,0,.06);background:rgba(255,255,255,.72);backdrop-filter:blur(20px) saturate(180%);-webkit-backdrop-filter:blur(20px) saturate(180%);border-radius:14px;list-style:none;transition:all .18s cubic-bezier(.4,0,.2,1);overflow:hidden;margin-bottom:12px;box-shadow:0 1px 2px rgba(0,0,0,.04),0 10px 30px rgba(0,0,0,.06);color:#1d1d1f;min-width:0}",
      "@media (prefers-color-scheme:dark){.tdr-card{background:rgba(30,30,32,.7);border:1px solid rgba(255,255,255,.08);color:#f5f5f7;box-shadow:0 1px 2px rgba(0,0,0,.2),0 10px 30px rgba(0,0,0,.3)}}",
      ".tdr-header{width:100%;color:inherit;cursor:pointer;text-align:left;font:inherit;background:0 0;border:0;align-items:center;gap:12px;padding:16px 20px;display:flex}",
      ".tdr-header:hover{background:rgba(0,0,0,.03)}",
      "@media (prefers-color-scheme:dark){.tdr-header:hover{background:rgba(255,255,255,.04)}}",
      ".tdr-cardPage>.tdr-header{cursor:default}",
      ".tdr-cardPage .tdr-chevron{display:none}",
      ".tdr-headText{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}",
      ".tdr-name{font-weight:600;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".tdr-desc{font-size:13px;color:#6e6e73;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      "@media (prefers-color-scheme:dark){.tdr-desc{color:#a1a1a6}}",
      ".tdr-chevron{color:#6e6e73;flex:none;font-size:12px;transition:transform .18s}",
      ".tdr-chevronOpen{transform:rotate(180deg)}",
      ".tdr-body{display:flex;flex-direction:column;gap:16px;padding:0 20px 20px}",
      ".tdr-tabs{display:flex;gap:2px;padding:3px;border-radius:10px;background:rgba(120,120,128,.1)}",
      ".tdr-tab{flex:1;border:0;background:0 0;font:inherit;font-size:13px;font-weight:500;color:#6e6e73;padding:7px 10px;border-radius:8px;cursor:pointer;white-space:nowrap}",
      ".tdr-tab:hover{color:#1d1d1f}",
      "@media (prefers-color-scheme:dark){.tdr-tab:hover{color:#f5f5f7}}",
      ".tdr-tabActive{background:#fff;color:#1d1d1f;box-shadow:0 1px 3px rgba(0,0,0,.1)}",
      "@media (prefers-color-scheme:dark){.tdr-tabActive{background:rgba(70,70,74,.9);color:#f5f5f7}}",
      ".tdr-panel{display:flex;flex-direction:column;gap:10px}",
      ".tdr-hint{font-size:12px;line-height:1.6;color:#6e6e73;margin:0}",
      "@media (prefers-color-scheme:dark){.tdr-hint{color:#a1a1a6}}",
      ".tdr-row{display:flex;flex-direction:column;gap:8px;padding:10px 12px;border-radius:10px;background:rgba(120,120,128,.06);border:1px solid rgba(120,120,128,.12)}",
      ".tdr-rowLine{display:flex;gap:8px;align-items:center;flex-wrap:wrap}",
      ".tdr-grow{flex:1;min-width:140px}",
      ".tdr-input{width:100%;box-sizing:border-box;font:inherit;font-size:13px;padding:6px 9px;border-radius:8px;border:1px solid rgba(120,120,128,.3);background:rgba(255,255,255,.8);color:inherit;outline:none}",
      ".tdr-input:focus{border-color:#0071e3;box-shadow:0 0 0 3px rgba(0,113,227,.15)}",
      "@media (prefers-color-scheme:dark){.tdr-input{background:rgba(40,40,44,.8);border-color:rgba(255,255,255,.16)}}",
      ".tdr-select{font:inherit;font-size:13px;padding:6px 8px;border-radius:8px;border:1px solid rgba(120,120,128,.3);background:rgba(255,255,255,.8);color:inherit}",
      "@media (prefers-color-scheme:dark){.tdr-select{background:rgba(40,40,44,.8);border-color:rgba(255,255,255,.16);color:inherit}}",
      ".tdr-btn{font:inherit;font-size:13px;font-weight:500;padding:6px 12px;border-radius:8px;border:1px solid rgba(120,120,128,.28);background:rgba(255,255,255,.9);color:inherit;cursor:pointer;white-space:nowrap}",
      ".tdr-btn:hover{background:#fff}",
      "@media (prefers-color-scheme:dark){.tdr-btn{background:rgba(60,60,64,.9)}.tdr-btn:hover{background:rgba(80,80,86,.9)}}",
      ".tdr-btnPrimary{background:#0071e3;border-color:#0071e3;color:#fff}",
      ".tdr-btnPrimary:hover{background:#0077ed}",
      ".tdr-btnDanger{color:#c9271f}",
      ".tdr-btn:disabled{opacity:.45;cursor:not-allowed}",
      ".tdr-chip{font-size:11px;line-height:1.4;padding:2px 7px;border-radius:999px;background:rgba(120,120,128,.14);color:#6e6e73;white-space:nowrap}",
      "@media (prefers-color-scheme:dark){.tdr-chip{color:#c7c7cc}}",
      ".tdr-chipOk{background:rgba(52,199,89,.16);color:#1f7a3d}",
      ".tdr-chipWarn{background:rgba(255,159,10,.16);color:#8a5300}",
      ".tdr-status{display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:12px;color:#6e6e73}",
      "@media (prefers-color-scheme:dark){.tdr-status{color:#a1a1a6}}",
      ".tdr-statusOk{color:#1f7a3d}",
      ".tdr-statusErr{color:#c9271f}",
      ".tdr-footer{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;padding-top:4px;border-top:1px solid rgba(120,120,128,.14)}",
      ".tdr-empty{font-size:13px;color:#6e6e73;padding:12px;text-align:center;border:1px dashed rgba(120,120,128,.3);border-radius:10px}",
      "@media (prefers-color-scheme:dark){.tdr-empty{color:#a1a1a6}}",
      ".tdr-mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;word-break:break-all}",
      ".tdr-historyList{display:flex;flex-direction:column;gap:6px;max-height:260px;overflow:auto}",
    ].join("\n");
    //#endregion

    //#region helpers
    const SOURCE_TYPE_LABELS = { bing: "Bing 免费通道", tavily: "Tavily", site: "指定站点" };

    // The client bundle is loaded by the Host module loader with react only, so
    // it cannot import lib/custom-search.js; the platform table exists in both
    // places on purpose. Keep the two lists in sync when adding a platform.
    const PLATFORMS = [
      { match: /(^|\.)bilibili\.com$/i, domain: "bilibili.com", label: "B站" },
      { match: /(^|\.)weibo\.com$/i, domain: "weibo.com", label: "微博" },
      { match: /(^|\.)zhihu\.com$/i, domain: "zhihu.com", label: "知乎" },
      { match: /(^|\.)(x|twitter)\.com$/i, domain: "x.com", label: "X" },
      { match: /(^|\.)youtube\.com$/i, domain: "youtube.com", label: "YouTube" },
      { match: /(^|\.)douyin\.com$/i, domain: "douyin.com", label: "抖音" },
      { match: /(^|\.)kuaishou\.com$/i, domain: "kuaishou.com", label: "快手" },
      { match: /(^|\.)xiaohongshu\.com$/i, domain: "xiaohongshu.com", label: "小红书" },
      { match: /(^|\.)github\.com$/i, domain: "github.com", label: "GitHub" },
      { match: /(^|\.)medium\.com$/i, domain: "medium.com", label: "Medium" },
      { match: /(^|\.)substack\.com$/i, domain: "substack.com", label: "Substack" },
      { match: /(^|\.)csdn\.net$/i, domain: "csdn.net", label: "CSDN" },
      { match: /(^|\.)juejin\.cn$/i, domain: "juejin.cn", label: "掘金" },
      { match: /(^|\.)sspai\.com$/i, domain: "sspai.com", label: "少数派" },
      { match: /(^|\.)mp\.weixin\.qq\.com$/i, domain: "mp.weixin.qq.com", label: "公众号" },
    ];

    /** Best-effort client-side hint; the Host's /preview is the authority. */
    function describeLink(rawUrl) {
      if (typeof rawUrl !== "string" || rawUrl.trim() === "") return null;
      let url;
      try {
        url = new URL(rawUrl.trim().startsWith("http") ? rawUrl.trim() : `https://${rawUrl.trim()}`);
      } catch {
        return null;
      }
      const host = url.hostname.toLowerCase();
      const hit = PLATFORMS.find(item => item.match.test(host));
      if (!hit) return null;
      return { platform: hit.label, domain: hit.domain, handle: url.pathname.split("/").filter(Boolean).pop() ?? "" };
    }

    function newEntry(fields) {
      return { id: `draft-${Math.random().toString(36).slice(2, 10)}`, ...fields };
    }

    function emptyDraft() {
      return { searchSources: [], topics: [], bloggers: [], delivery: { mode: "file" } };
    }

    function counts(draft) {
      const sources = draft.searchSources?.length ?? 0;
      const topics = draft.topics?.length ?? 0;
      const bloggers = draft.bloggers?.length ?? 0;
      return { sources, topics, bloggers, total: sources + topics + bloggers };
    }

    async function bridge(path, payload) {
      const response = await fetch(`${BRIDGE_PREFIX}/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload ?? {}),
      });
      const data = await response.json();
      if (!response.ok || data?.ok === false) {
        throw new Error(data?.message ?? `设置桥接失败：HTTP ${response.status}`);
      }
      return data;
    }

    function formatTime(value) {
      if (!value) return "未知时间";
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return String(value);
      const pad = n => String(n).padStart(2, "0");
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }

    function summaryText() {
      return "DSH-Search-Contrl · 输出方式 / 搜索源 / 主题 / 博主 / 登录 Cookie / 版本回退";
    }
    //#endregion

    //#region components
    function Field(props) {
      const { label, value, onChange, placeholder, mono, secret } = props;
      return h(
        "label",
        { className: "tdr-grow", style: { display: "flex", flexDirection: "column", gap: "4px" } },
        h("span", { className: "tdr-hint" }, label),
        h("input", {
          className: `tdr-input${mono ? " tdr-mono" : ""}`,
          type: secret ? "password" : "text",
          value: value ?? "",
          placeholder: placeholder ?? "",
          spellCheck: false,
          onChange: event => onChange(event.target.value),
        })
      );
    }

    function SourceRow({ source, onChange, onRemove }) {
      return h(
        "div",
        { className: "tdr-row" },
        h(
          "div",
          { className: "tdr-rowLine" },
          h(Field, { label: "名称", value: source.label, onChange: label => onChange({ ...source, label }) }),
          h(
            "label",
            { style: { display: "flex", flexDirection: "column", gap: "4px" } },
            h("span", { className: "tdr-hint" }, "类型"),
            h(
              "select",
              { className: "tdr-select", value: source.type ?? "bing", onChange: event => onChange({ ...source, type: event.target.value }) },
              Object.entries(SOURCE_TYPE_LABELS).map(([value, label]) => h("option", { key: value, value }, label))
            )
          ),
          source.type === "site"
            ? h(Field, { label: "站点域名", value: source.domain, placeholder: "www.reuters.com", onChange: domain => onChange({ ...source, domain }) })
            : null,
          h(
            "button",
            { type: "button", className: "tdr-btn tdr-btnDanger", onClick: onRemove },
            "删除"
          )
        ),
        h(
          "label",
          { className: "tdr-rowLine", style: { gap: "6px" } },
          h("input", {
            type: "checkbox",
            checked: source.enabled !== false,
            onChange: event => onChange({ ...source, enabled: event.target.checked }),
          }),
          h("span", { className: "tdr-hint" }, "启用（停用后不参与检索，配置保留）")
        )
      );
    }

    function TopicRow({ topic, onChange, onRemove }) {
      const keywords = Array.isArray(topic.keywords) ? topic.keywords.join("，") : "";
      const domains = Array.isArray(topic.domains) ? topic.domains.join("，") : "";
      return h(
        "div",
        { className: "tdr-row" },
        h(
          "div",
          { className: "tdr-rowLine" },
          h(Field, { label: "主题名", value: topic.label, onChange: label => onChange({ ...topic, label }) }),
          h(
            "button",
            { type: "button", className: "tdr-btn tdr-btnDanger", onClick: onRemove, style: { alignSelf: "flex-end" } },
            "删除"
          )
        ),
        h(Field, {
          label: "关键词（逗号或顿号分隔，会组合成一条查询）",
          value: keywords,
          placeholder: "固态电池，量产，装车",
          onChange: value => onChange({ ...topic, keywords: value.split(/[,，、;；\n]+/).map(item => item.trim()).filter(Boolean) }),
        }),
        h(Field, {
          label: "限定站点（可选，逗号分隔；留空表示全网搜索）",
          value: domains,
          placeholder: "reuters.com，bloomberg.com",
          onChange: value => onChange({ ...topic, domains: value.split(/[,，、;；\s]+/).map(item => item.trim()).filter(Boolean) }),
        })
      );
    }

    function BloggerRow({ blogger, onChange, onRemove }) {
      const parsed = describeLink(blogger.url);
      return h(
        "div",
        { className: "tdr-row" },
        h(
          "div",
          { className: "tdr-rowLine" },
          h(Field, {
            label: "博主主页链接（完整 URL）",
            value: blogger.url,
            placeholder: "https://space.bilibili.com/123456",
            onChange: url => onChange({ ...blogger, url }),
          }),
          h(Field, {
            label: "备注名（可选）",
            value: blogger.label,
            placeholder: "用于报告里标注来源",
            onChange: label => onChange({ ...blogger, label }),
          }),
          h(
            "button",
            { type: "button", className: "tdr-btn tdr-btnDanger", onClick: onRemove, style: { alignSelf: "flex-end" } },
            "删除"
          )
        ),
        h(
          "div",
          { className: "tdr-rowLine" },
          parsed
            ? h("span", { className: "tdr-chip tdr-chipOk" }, `识别为 ${parsed.platform} · site:${parsed.domain}`)
            : h("span", { className: "tdr-chip tdr-chipWarn" }, "暂未识别平台，保存时会再次校验"),
          h("button", {
            type: "button",
            className: "tdr-btn",
            onClick: async () => {
              try {
                const result = await bridge("preview", { kind: "blogger", url: blogger.url, label: blogger.label });
                const queries = result.value?.queries ?? [];
                alert(`将发送 ${queries.length} 条查询：\n\n${queries.join("\n")}\n\n${result.value?.note ?? ""}`);
              } catch (error) {
                alert(`预览失败：${error instanceof Error ? error.message : String(error)}`);
              }
            },
          }, "预览查询")
        )
      );
    }

    function HistoryPanel({ history, onRollback, busy }) {
      if (!Array.isArray(history) || history.length === 0) {
        return h("div", { className: "tdr-empty" }, "还没有历史版本。每次保存、重置或回退前都会自动快照上一版。");
      }
      return h(
        "div",
        { className: "tdr-historyList" },
        history.map(entry =>
          h(
            "div",
            { key: entry.id, className: "tdr-row", style: { flexDirection: "row", alignItems: "center", gap: "10px" } },
            h(
              "div",
              { className: "tdr-grow", style: { display: "flex", flexDirection: "column", gap: "2px" } },
              h("div", { className: "tdr-mono" }, entry.id),
              h(
                "div",
                { className: "tdr-hint" },
                `${formatTime(entry.createdAt)} · ${entry.reason ?? "保存"} · 搜索源 ${entry.counts?.sources ?? 0} / 主题 ${entry.counts?.topics ?? 0} / 博主 ${entry.counts?.bloggers ?? 0}`
              )
            ),
            h("button", { type: "button", className: "tdr-btn", disabled: busy, onClick: () => onRollback(entry.id) }, "回退到此版本")
          )
        )
      );
    }

    /**
     * 登录 Cookie 面板。
     *
     * 流程：点「获取 Cookie」→ Host 打开一个干净的浏览器窗口并停在登录页 →
     * 用户自己登录 → Host 通过 DevTools 协议读取该站点 Cookie → 只保留能证明
     * 登录态的那几个 → 关窗并落盘。渲染进程始终只看到 Cookie 名字与过期时间，
     * 拿不到值，所以设置页泄露不了会话。
     */
    function CookiePanel({ sites, masked, status, busy, onStart, onCancel, onClear, onRefresh }) {
      const statusKind = status?.state === "done" ? " tdr-statusOk" : status?.state === "error" ? " tdr-statusErr" : "";
      const row = site => {
        const saved = (masked?.sites ?? []).find(item => item.site === site.id);
        const running = status?.state === "waiting" && status?.site === site.id;
        return h(
          "div",
          { className: "tdr-row", key: site.id },
          h(
            "div",
            { className: "tdr-grow", style: { display: "flex", flexDirection: "column", gap: "2px" } },
            h(
              "div",
              { className: "tdr-rowLine" },
              h("span", { className: "tdr-name", style: { fontSize: "13px", fontWeight: 600 } }, site.label),
              h("span", { className: "tdr-chip" }, site.domain),
              saved
                ? h("span", { className: "tdr-chip tdr-chipOk" }, "已登录 · " + saved.cookies.length + " 个 Cookie")
                : h("span", { className: "tdr-chip tdr-chipWarn" }, "未登录"),
              running ? h("span", { className: "tdr-chip tdr-chipWarn" }, "等待登录…") : null
            ),
            h("div", { className: "tdr-hint" }, site.why),
            saved
              ? h(
                  "div",
                  { className: "tdr-hint tdr-mono" },
                  saved.cookies.map(cookie => cookie.name).join(" / ") + " · 保存于 " + formatTime(saved.savedAt)
                )
              : null
          ),
          h(
            "div",
            { className: "tdr-rowLine" },
            running
              ? h("button", { type: "button", className: "tdr-btn", onClick: onCancel }, "取消")
              : h(
                  "button",
                  { type: "button", className: "tdr-btn tdr-btnPrimary", disabled: busy, onClick: () => onStart(site.id) },
                  saved ? "重新获取" : "获取 Cookie"
                ),
            saved ? h("button", { type: "button", className: "tdr-btn tdr-btnDanger", disabled: busy, onClick: () => onClear(site.id) }, "清除") : null
          )
        );
      };

      return h(
        "div",
        { className: "tdr-panel" },
        h(
          "p",
          { className: "tdr-hint" },
          "点「获取 Cookie」会打开一个全新的浏览器窗口（独立临时配置，不碰你日常的浏览器数据）。在窗口里正常登录，登录成功后窗口会自动关闭。Cookie 只保存在本机插件数据目录，页面只显示 Cookie 名字，不显示值。"
        ),
        h(
          "div",
          { className: "tdr-status" + statusKind },
          h("span", null, (status && status.message) || "未开始"),
          h("button", { type: "button", className: "tdr-btn", disabled: busy, onClick: onRefresh }, "刷新状态")
        ),
        h(
          "div",
          { style: { display: "flex", flexDirection: "column", gap: "8px" } },
          (sites ?? []).map(row)
        ),
        h(
          "p",
          { className: "tdr-hint" },
          masked && masked.counts
            ? "已保存 " + masked.counts.sites + " 个站点、共 " + masked.counts.cookies + " 个 Cookie（其中 " + masked.counts.loggedIn + " 个确认登录态）"
            : "还没有保存任何登录 Cookie"
        )
      );
    }

    function Tabs({ active, onChange }) {
      const items = [
        { id: "sources", label: "搜索源" },
        { id: "topics", label: "主题" },
        { id: "bloggers", label: "博主" },
        { id: "cookies", label: "登录 Cookie" },
        { id: "history", label: "历史版本" },
      ];
      return h(
        "div",
        { className: "tdr-tabs", role: "tablist" },
        items.map(item =>
          h(
            "button",
            {
              key: item.id,
              type: "button",
              role: "tab",
              "aria-selected": active === item.id,
              className: `tdr-tab${active === item.id ? " tdr-tabActive" : ""}`,
              onClick: () => onChange(item.id),
            },
            item.label
          )
        )
      );
    }

    // 报告输出方式：文件、聊天、两者。同一个 draft 一起保存，回退时一并还原。
    const DELIVERY_OPTIONS = [
      { value: "file", label: "只给文件", hint: "写入 reports/ 并给出文件路径" },
      { value: "chat", label: "只在聊天中呈现", hint: "不写文件，正文直接发在对话里" },
      { value: "both", label: "文件 + 聊天", hint: "写文件，同时把正文发在对话里" },
    ];

    function DeliveryPicker({ mode, onChange }) {
      return h(
        "div",
        { className: "tdr-rowLine", style: { flexWrap: "wrap", gap: "10px" } },
        DELIVERY_OPTIONS.map(option =>
          h(
            "label",
            {
              key: option.value,
              title: option.hint,
              style: {
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "6px 10px",
                borderRadius: "8px",
                border: (mode ?? "file") === option.value ? "1px solid #4c8dff" : "1px solid rgba(120,120,128,.28)",
                cursor: "pointer",
              },
            },
            h("input", {
              type: "radio",
              name: "tdr-delivery",
              value: option.value,
              checked: (mode ?? "file") === option.value,
              onChange: () => onChange(option.value),
            }),
            h("span", null, option.label)
          )
        ),
        h("span", { className: "tdr-hint" }, (DELIVERY_OPTIONS.find(item => item.value === (mode ?? "file")) ?? DELIVERY_OPTIONS[0]).hint)
      );
    }

    function SettingsCard({ page }) {
      const [open, setOpen] = react.useState(true);
      const [tab, setTab] = react.useState("sources");
      const [draft, setDraft] = react.useState(emptyDraft);
      const [history, setHistory] = react.useState([]);
      const [meta, setMeta] = react.useState({});
      const [status, setStatus] = react.useState({ kind: "loading", text: "正在读取设置…" });
      const [dirty, setDirty] = react.useState(false);
      const [busy, setBusy] = react.useState(false);
      const [cookieSites, setCookieSites] = react.useState([]);
      const [cookieMasked, setCookieMasked] = react.useState(null);
      const [cookieStatus, setCookieStatus] = react.useState(null);
      const [cookieBusy, setCookieBusy] = react.useState(false);
      // The Host caches plugin modules in process, so a newer bundle on disk is not
      // enough. When the describe answer lacks the delivery capability marker the
      // Host is still running a pre-2.2.0 copy and would drop `delivery` on save —
      // say so instead of letting the picker snap back to "只给文件".
      const [serverStale, setServerStale] = react.useState(false);

      const load = react.useCallback(async () => {
        try {
          const result = await bridge("describe");
          const value = result.value ?? {};
          setDraft({ ...emptyDraft(), ...(value.settings ?? {}) });
          setHistory(Array.isArray(value.history) ? value.history : []);
          setMeta(value.meta ?? {});
          setServerStale(value.meta?.features?.delivery !== true);
          setDirty(false);
          setStatus({ kind: "ok", text: `已加载 ${value.meta?.pluginVersion ? `v${value.meta.pluginVersion}` : "设置"}${value.meta?.error ? ` · ${value.meta.error}` : ""}` });
        } catch (error) {
          setStatus({ kind: "err", text: `读取失败：${error instanceof Error ? error.message : String(error)}` });
        }
      }, []);

      react.useEffect(() => {
        load();
      }, [load]);

      const mutate = next => {
        setDraft(next);
        setDirty(true);
        setStatus({ kind: "idle", text: "有未保存的修改" });
      };

      const save = async () => {
        setBusy(true);
        try {
          const result = await bridge("save", { settings: draft });
          const value = result.value ?? {};
          const echoed = value.settings ?? {};
          const wanted = draft.delivery?.mode ?? "file";
          const keptDelivery = echoed.delivery?.mode === wanted;
          setHistory(Array.isArray(value.history) ? value.history : []);
          if (!keptDelivery) {
            // Do not overwrite the draft: the user's pick stays on screen, and the
            // status says plainly why it did not stick.
            setServerStale(true);
            setStatus({
              kind: "err",
              text: "「报告输出方式」被正在运行的旧版服务端丢弃了：DSH 里加载的还是 2.2.0 之前的插件，进程内模块不会随文件改动热更新。重启 DSH 后重新保存即可生效，你刚才的选择仍保留在本页。",
            });
            return;
          }
          setDraft({ ...emptyDraft(), ...echoed });
          setDirty(false);
          setStatus({ kind: "ok", text: `已保存 · 上一版已存入历史（共 ${value.history?.length ?? 0} 个版本）` });
        } catch (error) {
          setStatus({ kind: "err", text: `保存失败：${error instanceof Error ? error.message : String(error)}` });
        } finally {
          setBusy(false);
        }
      };

      const reset = async () => {
        if (!confirm("清空所有自定义搜索源、主题和博主？当前版本会先存入历史，可以回退。")) return;
        setBusy(true);
        try {
          const result = await bridge("reset");
          const value = result.value ?? {};
          setDraft({ ...emptyDraft(), ...(value.settings ?? {}) });
          setHistory(Array.isArray(value.history) ? value.history : []);
          setDirty(false);
          setStatus({ kind: "ok", text: "已清空，旧版本仍在历史里" });
        } catch (error) {
          setStatus({ kind: "err", text: `重置失败：${error instanceof Error ? error.message : String(error)}` });
        } finally {
          setBusy(false);
        }
      };

      const rollback = async id => {
        if (!confirm(`回退到 ${id}？当前版本也会先存入历史，可再次回退。`)) return;
        setBusy(true);
        try {
          const result = await bridge("rollback", { id });
          const value = result.value ?? {};
          setDraft({ ...emptyDraft(), ...(value.settings ?? {}) });
          setHistory(Array.isArray(value.history) ? value.history : []);
          setDirty(false);
          setStatus({ kind: "ok", text: `已回退到 ${id}` });
        } catch (error) {
          setStatus({ kind: "err", text: `回退失败：${error instanceof Error ? error.message : String(error)}` });
        } finally {
          setBusy(false);
        }
      };

      const loadCookies = react.useCallback(async () => {
        try {
          const result = await bridge("cookie/list");
          const value = result.value ?? {};
          setCookieSites(Array.isArray(value.sites) ? value.sites : []);
          setCookieMasked(value.masked ?? null);
          setCookieStatus(value.status ?? null);
        } catch (error) {
          setCookieStatus({ state: "error", message: "读取 Cookie 状态失败：" + (error instanceof Error ? error.message : String(error)) });
        }
      }, []);

      react.useEffect(() => {
        if (page || open) loadCookies();
      }, [loadCookies, page, open]);

      react.useEffect(() => {
        if (!cookieStatus || cookieStatus.state !== "waiting") return undefined;
        const timer = setInterval(async () => {
          try {
            const result = await bridge("cookie/status");
            const value = result.value ?? {};
            setCookieStatus(value.status ?? null);
            if (value.masked) setCookieMasked(value.masked);
            if (!value.status || value.status.state !== "waiting") setCookieBusy(false);
          } catch {
            // 单次轮询失败不致命，下一个 tick 会重试。
          }
        }, 2000);
        return () => clearInterval(timer);
      }, [cookieStatus && cookieStatus.state]);

      const startCookie = async siteId => {
        setCookieBusy(true);
        try {
          const result = await bridge("cookie/start", { site: siteId });
          setCookieStatus((result.value && result.value.status) || { state: "waiting", site: siteId, message: "正在启动浏览器…" });
        } catch (error) {
          setCookieBusy(false);
          setCookieStatus({ state: "error", message: error instanceof Error ? error.message : String(error) });
        }
      };

      const cancelCookie = async () => {
        try {
          await bridge("cookie/cancel");
        } catch {
          // 取消是尽力而为，捕获会话本身也有超时兜底。
        }
        setCookieBusy(false);
      };

      const clearCookie = async siteId => {
        if (!confirm("清除 " + siteId + " 的登录 Cookie？清除后该站点的定向检索会退回搜索引擎。")) return;
        setCookieBusy(true);
        try {
          const result = await bridge("cookie/clear", { site: siteId });
          setCookieMasked((result.value && result.value.masked) || null);
        } catch (error) {
          setCookieStatus({ state: "error", message: error instanceof Error ? error.message : String(error) });
        } finally {
          setCookieBusy(false);
        }
      };

      const total = counts(draft).total;
      const header = h(
        "button",
        {
          type: "button",
          className: "tdr-header",
          onClick: () => page || setOpen(previous => !previous),
          "aria-expanded": page ? true : open,
        },
        h(
          "div",
          { className: "tdr-headText" },
          h("div", { className: "tdr-name" }, "DSH-Search-Contrl"),
          h(
            "div",
            { className: "tdr-desc" },
            total === 0
              ? "未配置自定义项，报告按固定六板块执行"
              : `搜索源 ${counts(draft).sources} · 主题 ${counts(draft).topics} · 博主 ${counts(draft).bloggers}`
          )
        ),
        h("span", { className: `tdr-chevron${open ? " tdr-chevronOpen" : ""}` }, "▼")
      );

      const body = h(
        "div",
        { className: "tdr-body" },
        h(
          "div",
          { className: `tdr-status${status.kind === "ok" ? " tdr-statusOk" : status.kind === "err" ? " tdr-statusErr" : ""}` },
          h("span", null, status.text),
          meta.dataDir ? h("span", { className: "tdr-mono" }, meta.dataDir) : null
        ),
        h(
          "div",
          { className: "tdr-panel", style: { paddingBottom: "6px" } },
          h("div", { className: "tdr-hint", style: { marginBottom: "6px" } }, "报告输出方式（日报 / 周报的交付形态）"),
          h(DeliveryPicker, {
            mode: draft.delivery && draft.delivery.mode,
            onChange: mode => mutate({ ...draft, delivery: { mode } }),
          }),
          serverStale
            ? h(
                "div",
                { className: "tdr-status tdr-statusErr", style: { marginTop: "8px" } },
                "当前 DSH 进程里加载的仍是 2.2.0 之前的插件，保存会丢弃「报告输出方式」。重启 DSH 后重新保存即可生效。"
              )
            : null
        ),

        h(Tabs, { active: tab, onChange: setTab }),

        tab === "sources"
          ? h(
              "div",
              { className: "tdr-panel" },
              h(
                "p",
                { className: "tdr-hint" },
                "搜索源决定查询走哪条通道：Bing 免费、Tavily 需要 API Key、指定站点会把查询限定在某个域名内。"
              ),
              (draft.searchSources ?? []).length === 0
                ? h("div", { className: "tdr-empty" }, "还没有自定义搜索源")
                : (draft.searchSources ?? []).map((source, index) =>
                    h(SourceRow, {
                      key: source.id ?? index,
                      source,
                      onChange: next => mutate({ ...draft, searchSources: draft.searchSources.map((item, i) => (i === index ? next : item)) }),
                      onRemove: () => mutate({ ...draft, searchSources: draft.searchSources.filter((_, i) => i !== index) }),
                    })
                  ),
              h(
                "button",
                {
                  type: "button",
                  className: "tdr-btn",
                  onClick: () => mutate({ ...draft, searchSources: [...(draft.searchSources ?? []), newEntry({ label: "", type: "bing", enabled: true, domain: "" })] }),
                },
                "+ 添加搜索源"
              )
            )
          : null,

        tab === "topics"
          ? h(
              "div",
              { className: "tdr-panel" },
              h(
                "p",
                { className: "tdr-hint" },
                "主题不限于科技：填入任意领域的关键词即可。加了限定站点会按站点逐条查询（最多 4 条），不加就是一条全网查询。"
              ),
              (draft.topics ?? []).length === 0
                ? h("div", { className: "tdr-empty" }, "还没有自定义主题")
                : (draft.topics ?? []).map((topic, index) =>
                    h(TopicRow, {
                      key: topic.id ?? index,
                      topic,
                      onChange: next => mutate({ ...draft, topics: draft.topics.map((item, i) => (i === index ? next : item)) }),
                      onRemove: () => mutate({ ...draft, topics: draft.topics.filter((_, i) => i !== index) }),
                    })
                  ),
              h(
                "button",
                {
                  type: "button",
                  className: "tdr-btn",
                  onClick: () => mutate({ ...draft, topics: [...(draft.topics ?? []), newEntry({ label: "", keywords: [], domains: [] })] }),
                },
                "+ 添加主题"
              )
            )
          : null,

        tab === "bloggers"
          ? h(
              "div",
              { className: "tdr-panel" },
              h(
                "p",
                { className: "tdr-hint" },
                "粘贴博主主页链接，报告会检索该账号在这个平台上的公开内容。公众号、抖音、小红书等封闭平台可能搜不到，只能覆盖被搜索引擎收录的部分。"
              ),
              (draft.bloggers ?? []).length === 0
                ? h("div", { className: "tdr-empty" }, "还没有添加博主")
                : (draft.bloggers ?? []).map((blogger, index) =>
                    h(BloggerRow, {
                      key: blogger.id ?? index,
                      blogger,
                      onChange: next => mutate({ ...draft, bloggers: draft.bloggers.map((item, i) => (i === index ? next : item)) }),
                      onRemove: () => mutate({ ...draft, bloggers: draft.bloggers.filter((_, i) => i !== index) }),
                    })
                  ),
              h(
                "button",
                {
                  type: "button",
                  className: "tdr-btn",
                  onClick: () => mutate({ ...draft, bloggers: [...(draft.bloggers ?? []), newEntry({ label: "", url: "" })] }),
                },
                "+ 添加博主"
              )
            )
          : null,

        tab === "cookies"
          ? h(CookiePanel, {
              sites: cookieSites,
              masked: cookieMasked,
              status: cookieStatus,
              busy: cookieBusy,
              onStart: startCookie,
              onCancel: cancelCookie,
              onClear: clearCookie,
              onRefresh: loadCookies,
            })
          : null,

        tab === "history" ? h(HistoryPanel, { history, onRollback: rollback, busy }) : null,

        h(
          "div",
          { className: "tdr-footer" },
          h(
            "div",
            { className: "tdr-rowLine" },
            h(
              "button",
              { type: "button", className: "tdr-btn tdr-btnPrimary", disabled: busy || !dirty, onClick: save },
              busy ? "处理中…" : dirty ? "保存并生成历史版本" : "已保存"
            ),
            h("button", { type: "button", className: "tdr-btn", disabled: busy, onClick: load }, "重新读取")
          ),
          h("button", { type: "button", className: "tdr-btn tdr-btnDanger", disabled: busy || total === 0, onClick: reset }, "清空自定义项")
        )
      );

      return h(
        "div",
        { className: `tdr-card${page ? " tdr-cardPage" : ""}` },
        page ? h(react.Fragment, null, header, body) : h(react.Fragment, null, header, open ? body : null),
        h("style", null, CSS)
      );
    }
    //#endregion

    const inject = ["slots"];

    // 设置 → 侧边栏的一级分区顺序。已安装插件的分区占 100–151
    // （wallpaper-engine 100 / web-ui-settings 110 / skin-center 120 / pet 130 /
    // market 150 / usage 151），本分区排在它们之后。
    const SECTION_ORDER = 152;
    const SECTION_ID = "search-contrl-settings";
    const SECTION_LABEL = "搜索控制";

    function apply(ctx) {
      // 1) 一级设置分区：设置 → 侧边栏「搜索控制」。
      // 这是用户要的入口：不是插件详情页里的配置行，而是设置窗口左侧导航里的
      // 一个独立分区，点进去直接就是搜索源 / 主题 / 博主 / 历史版本四个页签。
      ctx.slots.inject("settings.section", () =>
        ctx.slots.register(
          { name: "settings.section", id: SECTION_ID, order: SECTION_ORDER, label: SECTION_LABEL },
          () => react_jsx_runtime.jsx(SettingsCard, { page: true })
        )
      );

      // 2) 插件行配置页（保留）：侧栏 插件 → 已安装 → search-contrl → 行配置页。
      // key 规则是 <包名>#<cordis.patch.yml 里声明的行 id>；
      // 配置读写走自建 bridge（/api/search-contrl-settings），不依赖其他插件。
      ctx.slots.inject("plugins.row.config", () =>
        ctx.slots.register(
          { name: "plugins.row.config", key: "dsh-search-contrl#search-contrl" },
          slotProps => (slotProps && slotProps.view === "summary" ? summaryText() : react_jsx_runtime.jsx(SettingsCard, { page: true }))
        )
      );
    }

    exports.apply = apply;
    exports.inject = inject;
    exports.SettingsCard = SettingsCard;
    exports.describeLink = describeLink;
    exports.CookiePanel = CookiePanel;
    return module.exports;
  },
});
