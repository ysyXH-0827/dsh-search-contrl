/**
 * Settings GUI for dsh-search-contrl (3.0).
 *
 * The Host serves this file as a Web module: plain CommonJS behind
 * window.__ModuleLoader__.load, React supplied by the page. It renders the
 * 「搜索控制」section in the shape the bundled settings pages use: one scroller
 * of grouped rows (label + hint on the left, control on the right) and a single
 * Save bar at the bottom, instead of the tab strip it used before 3.0.
 *
 * Everything here talks to the Host through POST /api/search-contrl-settings/*;
 * there is no direct filesystem access, and secrets never travel back up: the
 * cookie panels only ever see masked values.
 */
window.__ModuleLoader__.load({
  id: "dsh-search-contrl",
  factory(require) {
    const React = require("react");
    const h = React.createElement;

    const BRIDGE_PREFIX = "/api/search-contrl-settings";

    const MODES = [
      { value: "file", label: "只给文件", hint: "写入 reports/，回复里只给路径与要点" },
      { value: "chat", label: "只在聊天中呈现", hint: "不写文件，整份正文直接发在对话里" },
      { value: "both", label: "文件 + 聊天", hint: "写文件再完整发一遍（最费 token）" },
    ];
    const FORMATS = [
      { value: "table", label: "表格" },
      { value: "list", label: "分条" },
    ];
    const SCALES = [
      { value: "large", label: "大（少而精）" },
      { value: "medium", label: "中（默认）" },
      { value: "small", label: "小（多而全）" },
    ];
    const SOURCE_TYPES = [
      { value: "bing", label: "Bing 免费通道" },
      { value: "tavily", label: "Tavily" },
      { value: "site", label: "指定站点" },
    ];

    const DEFAULT_TITLE = "{主题}{类型}｜{日期}";
    const TITLE_TOKENS = [
      { token: "{主题}", label: "主题" },
      { token: "{类型}", label: "类型" },
      { token: "{日期}", label: "日期" },
    ];

    const PLATFORMS = [
      { match: /bilibili\.com|b23\.tv/i, domain: "bilibili.com", label: "B站" },
      { match: /weibo\.(com|cn)/i, domain: "weibo.com", label: "微博" },
      { match: /zhihu\.com/i, domain: "zhihu.com", label: "知乎" },
      { match: /(^|\.)x\.com|twitter\.com/i, domain: "x.com", label: "X" },
      { match: /youtube\.com|youtu\.be/i, domain: "youtube.com", label: "YouTube" },
      { match: /douyin\.com/i, domain: "douyin.com", label: "抖音" },
      { match: /kuaishou\.com/i, domain: "kuaishou.com", label: "快手" },
      { match: /xiaohongshu\.com|xhslink\.com/i, domain: "xiaohongshu.com", label: "小红书" },
      { match: /github\.com/i, domain: "github.com", label: "GitHub" },
      { match: /medium\.com/i, domain: "medium.com", label: "Medium" },
      { match: /substack\.com/i, domain: "substack.com", label: "Substack" },
      { match: /blog\.csdn\.net|csdn\.net/i, domain: "csdn.net", label: "CSDN" },
      { match: /juejin\.cn/i, domain: "juejin.cn", label: "掘金" },
      { match: /sspai\.com/i, domain: "sspai.com", label: "少数派" },
      { match: /mp\.weixin\.qq\.com/i, domain: "mp.weixin.qq.com", label: "公众号" },
    ];

    function describeLink(rawUrl) {
      const raw = String(rawUrl ?? "").trim();
      if (raw === "") return null;
      let parsed = null;
      try {
        parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
      } catch {
        return null;
      }
      const host = parsed.hostname.replace(/^www\./i, "");
      const hit = PLATFORMS.find(item => item.match.test(host));
      if (!hit) return null;
      const path = parsed.pathname.replace(/^\/+|\/+$/g, "");
      const handle = path.split("/").filter(Boolean).pop() ?? "";
      return { platform: hit.label, domain: hit.domain, handle };
    }

    const str = value => (typeof value === "string" ? value : value === 0 ? "0" : "");
    const num = (value, fallback) => (Number.isFinite(Number(value)) && value !== "" && value !== null ? Number(value) : fallback);
    const csv = list => (Array.isArray(list) ? list.join(", ") : "");
    const fromCsv = text => String(text ?? "").split(/[,，、;；]/).map(item => item.trim()).filter(Boolean);
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

    function kindForDays(days) {
      const value = num(days, 1);
      if (value <= 1) return "日报";
      if (value <= 7) return "周报";
      return "月报";
    }

    /** Local mirror of lib/report-title.js so the preview updates while typing. */
    function renderPreview(template, topic) {
      const raw = String(template ?? "").trim() === "" ? DEFAULT_TITLE : String(template);
      const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
      const filled = raw
        .replace(/\{主题\}/g, str(topic).trim() || "")
        .replace(/\{类型\}/g, kindForDays(1))
        .replace(/\{日期\}/g, today);
      const tidy = filled.replace(/\s*([｜|·\-—])\s*(?=[｜|·\-—])/g, "$1").replace(/^[｜|·\-—\s]+|[｜|·\-—\s]+$/g, "").trim();
      return tidy === "" ? `${kindForDays(1)}｜${today}` : tidy;
    }

    const EMPTY = {
      delivery: { mode: "file" },
      reportFormat: "table",
      eventScale: "medium",
      reportTitle: DEFAULT_TITLE,
      pointLength: { weibo: 20, bili: 50 },
      aiSummary: { bili: true },
      showPostPoints: true,
      showPostLinks: true,
      topics: [],
      searchSources: [],
      bloggers: [],
    };

    const CSS = [
      ".tdr-card{display:flex;flex-direction:column;gap:14px;padding:16px 18px 0;font-size:13px;line-height:1.6;color:var(--dsw-alias-label-primary,#1f2329);background:var(--dsw-alias-bg-layout,#fff);border-radius:12px;}",
      ".tdr-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding-bottom:10px;border-bottom:1px solid var(--dsw-alias-border-l1,#e6e8eb);}",
      ".tdr-title{font-size:15px;font-weight:600;margin:0;}",
      ".tdr-sub{color:var(--dsw-alias-label-secondary,#646a73);margin:4px 0 0;}",
      ".tdr-sec{padding-top:4px;}",
      ".tdr-secTitle{margin:0 0 2px;font-size:13px;font-weight:600;}",
      ".tdr-secDesc{margin:0 0 8px;color:var(--dsw-alias-label-secondary,#646a73);}",
      ".tdr-row{display:flex;align-items:flex-start;gap:12px;padding:8px 0;border-top:1px solid var(--dsw-alias-border-l1,#f0f1f2);}",
      ".tdr-row:first-of-type{border-top:none;}",
      ".tdr-rowMain{flex:1;min-width:0;}",
      ".tdr-rowLabel{font-weight:500;}",
      ".tdr-hint{margin:2px 0 0;color:var(--dsw-alias-label-secondary,#646a73);font-size:12px;}",
      ".tdr-ctrl{display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end;}",
      ".tdr-stack{display:flex;flex-direction:column;gap:8px;width:100%;}",
      ".tdr-input,.tdr-select{height:30px;padding:0 8px;border:1px solid var(--dsw-alias-border-l1,#d9dbe0);border-radius:8px;background:var(--dsw-alias-bg-layout,#fff);color:inherit;font:inherit;min-width:160px;}",
      ".tdr-input:focus,.tdr-select:focus{outline:2px solid var(--dsw-alias-brand,#4d6bfe);outline-offset:1px;}",
      ".tdr-input[disabled],.tdr-select[disabled]{opacity:.55;}",
      ".tdr-mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;}",
      ".tdr-num{width:88px;min-width:88px;text-align:center;}",
      ".tdr-seg{display:inline-flex;padding:2px;gap:2px;border-radius:9px;background:var(--dsw-alias-bg-container,#f5f6f7);}",
      ".tdr-segBtn{border:none;background:transparent;color:inherit;font:inherit;padding:4px 10px;border-radius:7px;cursor:pointer;}",
      ".tdr-segBtn[data-on=true]{background:var(--dsw-alias-bg-layout,#fff);box-shadow:0 1px 2px rgba(0,0,0,.12);font-weight:600;}",
      ".tdr-switch{position:relative;width:38px;height:22px;border-radius:11px;border:none;cursor:pointer;background:var(--dsw-alias-border-l1,#d9dbe0);transition:background .15s;}",
      ".tdr-switch[data-on=true]{background:var(--dsw-alias-brand,#4d6bfe);}",
      ".tdr-knob{position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;transition:transform .15s;}",
      ".tdr-switch[data-on=true] .tdr-knob{transform:translateX(16px);}",
      ".tdr-btn{height:30px;padding:0 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1,#d9dbe0);background:var(--dsw-alias-bg-layout,#fff);color:inherit;font:inherit;cursor:pointer;}",
      ".tdr-btn[disabled]{opacity:.5;cursor:not-allowed;}",
      ".tdr-btnPrimary{background:var(--dsw-alias-brand,#4d6bfe);border-color:transparent;color:#fff;font-weight:500;}",
      ".tdr-btnDanger{color:var(--dsw-alias-status-error,#d92d20);}",
      ".tdr-chip{display:inline-flex;align-items:center;gap:4px;padding:1px 8px;border-radius:999px;font-size:12px;background:var(--dsw-alias-bg-container,#f5f6f7);color:var(--dsw-alias-label-secondary,#646a73);}",
      ".tdr-chipOk{background:rgba(45,164,78,.12);color:#207a3c;}",
      ".tdr-chipWarn{background:rgba(219,146,0,.14);color:#8a5b00;}",
      ".tdr-item{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:10px;border:1px solid var(--dsw-alias-border-l1,#eceef1);border-radius:10px;margin-bottom:8px;background:var(--dsw-alias-bg-layout,#fff);}",
      ".tdr-item .tdr-wide{grid-column:1 / -1;}",
      ".tdr-itemHead{grid-column:1 / -1;display:flex;align-items:center;justify-content:space-between;gap:8px;}",
      ".tdr-empty{margin:6px 0;padding:10px 12px;border-radius:10px;background:var(--dsw-alias-bg-container,#f7f8f9);color:var(--dsw-alias-label-secondary,#646a73);}",
      ".tdr-note{margin:6px 0 0;font-size:12px;color:var(--dsw-alias-label-secondary,#646a73);}",
      ".tdr-err{color:var(--dsw-alias-status-error,#d92d20);}",
      ".tdr-ok{color:#207a3c;}",
      ".tdr-foot{position:sticky;bottom:0;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 0;margin-top:6px;border-top:1px solid var(--dsw-alias-border-l1,#e6e8eb);background:var(--dsw-alias-bg-layout,#fff);}",
      ".tdr-footBtns{display:flex;align-items:center;gap:8px;}",
      ".tdr-list{margin:6px 0 0;padding:0;list-style:none;}",
      ".tdr-listItem{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 0;border-top:1px solid var(--dsw-alias-border-l1,#f0f1f2);}",
    ];

    /* ---------- primitives ---------- */

    function Row({ label, hint, children, wide }) {
      return h("div", { className: `tdr-row${wide ? " tdr-wide" : ""}` },
        h("div", { className: "tdr-rowMain" },
          h("div", { className: "tdr-rowLabel" }, label),
          hint ? h("p", { className: "tdr-hint" }, hint) : null),
        h("div", { className: "tdr-ctrl" }, children));
    }

    function Section({ title, desc, children }) {
      return h("section", { className: "tdr-sec" },
        h("h3", { className: "tdr-secTitle" }, title),
        desc ? h("p", { className: "tdr-secDesc" }, desc) : null,
        children);
    }

    function Seg({ value, options, disabled, onChange }) {
      return h("div", { className: "tdr-seg", role: "group" },
        options.map(item => h("button", {
          key: item.value,
          type: "button",
          className: "tdr-segBtn",
          "data-on": String(item.value === value),
          disabled: Boolean(disabled),
          title: item.hint ?? item.label,
          onClick: () => onChange && onChange(item.value),
        }, item.label)));
    }

    function Select({ value, options, disabled, onChange }) {
      return h("select", {
        className: "tdr-select",
        value,
        disabled: Boolean(disabled),
        onChange: event => onChange && onChange(event.target.value),
      }, options.map(item => h("option", { key: item.value, value: item.value }, item.label)));
    }

    function TextField({ value, placeholder, disabled, mono, onChange }) {
      return h("input", {
        className: `tdr-input${mono ? " tdr-mono" : ""}`,
        type: "text",
        value,
        placeholder: placeholder ?? "",
        disabled: Boolean(disabled),
        onChange: event => onChange && onChange(event.target.value),
      });
    }

    function NumField({ value, min, max, step, disabled, onChange }) {
      return h("input", {
        className: "tdr-input tdr-num",
        type: "number",
        value,
        min,
        max,
        step: step ?? 1,
        disabled: Boolean(disabled),
        onChange: event => onChange && onChange(num(event.target.value, value)),
      });
    }

    function Toggle({ checked, disabled, onChange, label }) {
      return h("button", {
        type: "button",
        className: "tdr-switch",
        "data-on": String(Boolean(checked)),
        disabled: Boolean(disabled),
        "aria-label": label ?? "",
        onClick: () => onChange && onChange(!checked),
      }, h("span", { className: "tdr-knob" }));
    }

    function Btn({ children, kind, disabled, onClick }) {
      return h("button", {
        type: "button",
        className: `tdr-btn${kind === "primary" ? " tdr-btnPrimary" : ""}${kind === "danger" ? " tdr-btnDanger" : ""}`,
        disabled: Boolean(disabled),
        onClick,
      }, children);
    }

    function Chip({ children, kind }) {
      return h("span", { className: `tdr-chip${kind === "ok" ? " tdr-chipOk" : ""}${kind === "warn" ? " tdr-chipWarn" : ""}` }, children);
    }

    /* ---------- panels ---------- */

    function DeliveryPanel({ draft, meta, disabled, stale, onMode }) {
      const mode = draft.delivery?.mode ?? "file";
      return h(Section, { title: "报告输出方式与格式", desc: "下一份报告立即生效；旧的 DSH 进程没加载新代码时，这里会提示重启。" },
        h(Row, { label: "报告输出方式", hint: (MODES.find(item => item.value === mode) ?? MODES[0]).hint },
          h(Seg, { value: mode, options: MODES, disabled, onChange: onMode })),
        h(Row, { label: "板块呈现", hint: "表格适合扫读，分条适合在手机上看。" },
          h(Select, { value: draft.reportFormat ?? "table", options: FORMATS, disabled, onChange: value => meta.setDraft({ reportFormat: value }) })),
        h(Row, { label: "事件规模", hint: "决定条数下限：大 8–10 / 中 12–16 / 小 16–24（日报）。" },
          h(Select, { value: draft.eventScale ?? "medium", options: SCALES, disabled, onChange: value => meta.setDraft({ eventScale: value }) })),
        stale ? h("p", { className: "tdr-note tdr-err" }, "当前 DSH 进程里加载的仍是 2.2.0 之前的插件：这里保存的设置会被旧服务端丢弃，请重启 Host 后再改。") : null);
    }

    function TitlePanel({ draft, disabled, preset, setDraft }) {
      const template = str(draft.reportTitle) || DEFAULT_TITLE;
      const topic = str(draft.topics?.[0]?.label);
      return h(Section, { title: "报告标题", desc: "报告发出的第一行就是这个模板渲染出来的标题。" },
        h(Row, { label: "标题模板", hint: "留空则用默认模板；点下面的占位符插入到末尾。" },
          h(TextField, {
            value: template,
            placeholder: DEFAULT_TITLE,
            disabled,
            mono: true,
            onChange: value => setDraft({ reportTitle: value }),
          })),
        h(Row, { label: "占位符", hint: "{类型} 由窗口长度得出：≤1 天日报、≤7 天周报、更长月报。" },
          h("div", { className: "tdr-ctrl" }, TITLE_TOKENS.map(item => h(Btn, {
            key: item.token,
            disabled,
            onClick: () => setDraft({ reportTitle: `${template}${template.endsWith("｜") ? "" : ""}${item.token}` }),
          }, `${item.label} ${item.token}`)))),
        h(Row, { label: "预览", hint: preset ? `当前第一个主题「${str(draft.topics?.[0]?.label)}」命中预设 ${preset.id}。` : "设置里还没有主题，预览用空主题渲染。" },
          h("span", { className: "tdr-mono" }, renderPreview(template, topic))));
    }

    function TopicsPanel({ draft, meta, disabled, setDraft }) {
      const topics = Array.isArray(draft.topics) ? draft.topics : [];
      const presets = Array.isArray(meta?.meta?.topicPresets) ? meta.meta.topicPresets : [];
      const update = (index, patch) => {
        const next = topics.slice();
        next[index] = { ...next[index], ...patch };
        setDraft({ topics: next });
      };
      return h(Section, { title: "主题", desc: "主题决定去哪些站点、分哪些板块：命中预设就走预设的 RSS 与板块，没命中就先问你自己去找。" },
        topics.length === 0
          ? h("p", { className: "tdr-empty" }, "未配置自定义项，报告先问主题再检索。")
          : topics.map((topic, index) => h("div", { className: "tdr-item", key: topic.id ?? `topic-${index}` },
              h("div", { className: "tdr-itemHead" },
                h("strong", null, str(topic.label) || `主题 ${index + 1}`),
                h("div", { className: "tdr-ctrl" },
                  h(Toggle, {
                    checked: topic.enabled !== false,
                    disabled,
                    label: "启用主题",
                    onChange: value => update(index, { enabled: value }),
                  }),
                  h(Btn, { kind: "danger", disabled, onClick: () => setDraft({ topics: topics.filter((_, i) => i !== index) }) }, "删除"))),
              h(Row, { label: "名称", hint: "报告标题里的 {主题} 就是它。" },
                h(TextField, { value: str(topic.label), disabled, onChange: value => update(index, { label: value }) })),
              h(Row, { label: "预设", hint: "选「自动」就按名称与关键词匹配预设。" },
                h(Select, {
                  value: str(topic.preset),
                  options: [{ value: "", label: "自动匹配" }, ...presets.map(item => ({ value: str(item.id), label: str(item.label) }))],
                  disabled,
                  onChange: value => update(index, { preset: value }),
                })),
              h(Row, { label: "关键词", hint: "逗号分隔，用来拼检索词。" },
                h(TextField, { value: csv(topic.keywords), disabled, onChange: value => update(index, { keywords: fromCsv(value) }) })),
              h(Row, { label: "限定站点", hint: "逗号分隔域名；留空则不限定。" },
                h(TextField, { value: csv(topic.domains), disabled, onChange: value => update(index, { domains: fromCsv(value) }) }))))  ,
        h("div", { className: "tdr-ctrl" },
          h(Btn, { disabled, onClick: () => setDraft({ topics: topics.concat([{ id: `draft-${Date.now().toString(36)}`, label: "", keywords: [], domains: [], preset: "", enabled: true }]) }) }, "新增主题")));
    }

    function SourcesPanel({ draft, disabled, setDraft }) {
      const sources = Array.isArray(draft.searchSources) ? draft.searchSources : [];
      const update = (index, patch) => {
        const next = sources.slice();
        next[index] = { ...next[index], ...patch };
        setDraft({ searchSources: next });
      };
      return h(Section, { title: "搜索源", desc: "站点型源会变成 include_domains；通道型源会固定 provider。" },
        sources.length === 0
          ? h("p", { className: "tdr-empty" }, "未配置搜索源，检索按主题预设与免费 Bing 通道走。")
          : sources.map((source, index) => h("div", { className: "tdr-item", key: source.id ?? `source-${index}` },
              h("div", { className: "tdr-itemHead" },
                h("strong", null, str(source.label) || `搜索源 ${index + 1}`),
                h(Btn, { kind: "danger", disabled, onClick: () => setDraft({ searchSources: sources.filter((_, i) => i !== index) }) }, "删除")),
              h(Row, { label: "名称" },
                h(TextField, { value: str(source.label), disabled, onChange: value => update(index, { label: value }) })),
              h(Row, { label: "类型" },
                h(Select, { value: str(source.type) || "bing", options: SOURCE_TYPES, disabled, onChange: value => update(index, { type: value }) })),
              h(Row, { label: "站点或查询", hint: "站点型填域名，通道型可留空。" },
                h(TextField, { value: str(source.value), disabled, onChange: value => update(index, { value }) })))),
        h("div", { className: "tdr-ctrl" },
          h(Btn, { disabled, onClick: () => setDraft({ searchSources: sources.concat([{ id: `draft-${Date.now().toString(36)}`, label: "", type: "bing", value: "" }]) }) }, "新增搜索源")));
    }

    function BloggersPanel({ draft, disabled, setDraft, onPreview }) {
      const bloggers = Array.isArray(draft.bloggers) ? draft.bloggers : [];
      const update = (index, patch) => {
        const next = bloggers.slice();
        next[index] = { ...next[index], ...patch };
        setDraft({ bloggers: next });
      };
      return h(Section, { title: "博主", desc: "填入主页链接；报告末尾会出整节「博主动态」。" },
        bloggers.length === 0
          ? h("p", { className: "tdr-empty" }, "未配置博主，报告不含博主动态。")
          : bloggers.map((blogger, index) => {
              const link = describeLink(blogger.url);
              return h("div", { className: "tdr-item", key: blogger.id ?? `blogger-${index}` },
                h("div", { className: "tdr-itemHead" },
                  h("div", { className: "tdr-ctrl" },
                    h("strong", null, str(blogger.label) || `博主 ${index + 1}`),
                    link ? h(Chip, { kind: "ok" }, link.platform) : (str(blogger.url) ? h(Chip, { kind: "warn" }, "链接不可识别") : null)),
                  h(Btn, { kind: "danger", disabled, onClick: () => setDraft({ bloggers: bloggers.filter((_, i) => i !== index) }) }, "删除")),
                h(Row, { label: "名称" },
                  h(TextField, { value: str(blogger.label), disabled, onChange: value => update(index, { label: value }) })),
                h(Row, { label: "主页链接", hint: link ? `识别为 ${link.platform} / ${link.handle || "首页"}` : "支持 B站、微博、知乎、X、YouTube、GitHub 等 15 个平台" },
                  h(TextField, {
                    value: str(blogger.url),
                    disabled,
                    placeholder: "https://space.bilibili.com/…",
                    onChange: value => update(index, { url: value }),
                  })),
                h(Row, { label: "会搜什么", hint: "预览不会消耗 Tavily credit。" },
                  h(Btn, { disabled: disabled || !str(blogger.url), onClick: () => onPreview(blogger) }, "预览查询")));
            }),
        h("div", { className: "tdr-ctrl" },
          h(Btn, { disabled, onClick: () => setDraft({ bloggers: bloggers.concat([{ id: `draft-${Date.now().toString(36)}`, label: "", url: "" }]) }) }, "新增博主")));
    }

    function PostPanel({ draft, disabled, setDraft }) {
      const points = draft.pointLength ?? EMPTY.pointLength;
      return h(Section, { title: "博主动态展示", desc: "只影响「博主动态」这一节的写法。" },
        h(Row, { label: "微博要点字数", hint: "默认 20 字。" },
          h(NumField, { value: num(points.weibo, 20), min: 10, max: 200, disabled, onChange: value => setDraft({ pointLength: { ...points, weibo: value } }) })),
        h(Row, { label: "B 站要点字数", hint: "默认 50 字。" },
          h(NumField, { value: num(points.bili, 50), min: 10, max: 200, disabled, onChange: value => setDraft({ pointLength: { ...points, bili: value } }) })),
        h(Row, { label: "B 站用平台总结", hint: "关掉后由模型自己读标题、标签与播放数据写短评。" },
          h(Toggle, {
            checked: (draft.aiSummary?.bili ?? true) !== false,
            disabled,
            label: "B 站用平台总结",
            onChange: value => setDraft({ aiSummary: { ...(draft.aiSummary ?? {}), bili: value } }),
          })),
        h(Row, { label: "显示要点" },
          h(Toggle, {
            checked: draft.showPostPoints !== false,
            disabled,
            label: "显示要点",
            onChange: value => setDraft({ showPostPoints: value }),
          })),
        h(Row, { label: "显示原链接" },
          h(Toggle, {
            checked: draft.showPostLinks !== false,
            disabled,
            label: "显示原链接",
            onChange: value => setDraft({ showPostLinks: value }),
          })));
    }

    function CookiePanel({ sites, masked, status, busy, disabled, onStart, onCancel, onClear, onRefresh }) {
      const list = Array.isArray(sites) ? sites : [];
      const state = str(status?.state) || "idle";
      const counts = masked?.counts && typeof masked.counts === "object" ? masked.counts : {};
      return h(Section, { title: "登录 Cookie", desc: "捕获在本机浏览器里完成，渲染层只拿到掩码；Cookie 只用于取博主动态。" },
        h(Row, { label: "捕获状态", hint: state === "waiting" ? "浏览器窗口已打开，登录完成后会自动保存。" : "空闲时可以开始一次捕获。" },
          h("div", { className: "tdr-ctrl" },
            h(Chip, { kind: state === "waiting" ? "warn" : "ok" }, state === "waiting" ? "捕获中" : "空闲"),
            state === "waiting"
              ? h(Btn, { disabled: busy, onClick: onCancel }, "取消")
              : h(Btn, { disabled: busy, onClick: onRefresh }, "刷新状态"))),
        list.length === 0
          ? h("p", { className: "tdr-empty" }, "Cookie 站点信息读取中…")
          : list.map(site => h("div", { className: "tdr-listItem", key: site.id },
              h("div", { className: "tdr-rowMain" },
                h("div", { className: "tdr-rowLabel" }, `${str(site.label)}${site.required ? "（必需）" : ""}`),
                h("p", { className: "tdr-hint" }, `${num(counts[site.id], 0)} 个 Cookie 已保存${site.why ? ` · ${site.why}` : ""}`)),
              h("div", { className: "tdr-ctrl" },
                h(Btn, { disabled: busy || state === "waiting", onClick: () => onStart(site.id) }, "登录并捕获"),
                h(Btn, { kind: "danger", disabled: busy, onClick: () => onClear(site.id) }, "清除")))));
    }

    function HistoryPanel({ history, busy, onRollback }) {
      const list = Array.isArray(history) ? history : [];
      const label = item => {
        const when = str(item?.savedAt) || str(item?.id);
        const reason = str(item?.reason);
        return reason ? `${when} · ${reason}` : when;
      };
      return h(Section, { title: "历史版本", desc: "每次保存都会留一个快照，回退不会删掉当前设置。" },
        list.length === 0
          ? h("p", { className: "tdr-empty" }, "还没有历史版本。")
          : h("ul", { className: "tdr-list" }, list.slice(0, 8).map((item, index) => h("li", { className: "tdr-listItem", key: item.id ?? `hist-${index}` },
              h("span", { className: "tdr-mono" }, label(item)),
              h(Btn, { disabled: busy, onClick: () => onRollback(item.id) }, "回退")))));
    }

    /* ---------- card ---------- */

    function SettingsCard({ page }) {
      const [draft, setDraftState] = React.useState(null);
      const [saved, setSaved] = React.useState(null);
      const [meta, setMeta] = React.useState(null);
      const [status, setStatus] = React.useState({ kind: "loading", text: "正在读取设置…" });
      const [busy, setBusy] = React.useState(false);
      const [stale, setStale] = React.useState(false);
      const [cookie, setCookie] = React.useState({ sites: [], masked: null, status: null });
      const [history, setHistory] = React.useState([]);

      const bridge = React.useCallback(async function bridge(path, payload) {
        const response = await fetch(`${BRIDGE_PREFIX}/${path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload ?? {}),
        });
        let data = null;
        try {
          data = await response.json();
        } catch {
          data = null;
        }
        if (!data || data.ok === false) {
          const message = data && typeof data.message === "string" ? data.message : `HTTP ${response.status}`;
          throw new Error(message);
        }
        return data.value ?? {};
      }, []);

      const adopt = React.useCallback(payload => {
        const value = payload?.settings && typeof payload.settings === "object" ? payload.settings : payload;
        const merged = { ...EMPTY, ...(value ?? {}) };
        merged.delivery = { ...EMPTY.delivery, ...(value?.delivery ?? {}) };
        merged.pointLength = { ...EMPTY.pointLength, ...(value?.pointLength ?? {}) };
        merged.aiSummary = { ...EMPTY.aiSummary, ...(value?.aiSummary ?? {}) };
        merged.topics = Array.isArray(value?.topics) ? value.topics : [];
        merged.searchSources = Array.isArray(value?.searchSources) ? value.searchSources : [];
        merged.bloggers = Array.isArray(value?.bloggers) ? value.bloggers : [];
        setDraftState(merged);
        setSaved(merged);
        if (payload?.meta && typeof payload.meta === "object") setMeta(payload.meta);
        if (Array.isArray(payload?.history)) setHistory(payload.history);
      }, []);

      const load = React.useCallback(async () => {
        setStatus({ kind: "loading", text: "正在读取设置…" });
        try {
          const value = await bridge("describe");
          adopt(value);
          if (value?.meta?.features?.delivery !== true) {
            setStale(true);
            setStatus({ kind: "error", text: "当前 DSH 进程里加载的仍是 2.2.0 之前的插件，请重启 Host" });
          } else {
            setStale(false);
            setStatus({ kind: "ok", text: "已保存" });
          }
          try {
            const cookies = await bridge("cookie/list");
            setCookie({ sites: cookies.sites ?? [], masked: cookies.masked ?? null, status: cookies.status ?? null });
          } catch { /* cookie panel is optional */ }
        } catch (error) {
          setStatus({ kind: "error", text: `读取失败：${error.message}` });
        }
      }, [bridge, adopt]);

      React.useEffect(() => {
        load();
      }, [load]);

      const dirty = Boolean(draft && saved && !same(draft, saved));
      const patch = React.useCallback(update => {
        setDraftState(current => ({ ...(current ?? EMPTY), ...update }));
      }, []);
      const disabled = draft === null || busy;
      const panelMeta = { meta, setDraft: patch };
      const firstTopic = draft?.topics?.[0] ?? null;
      const presets = Array.isArray(meta?.topicPresets) ? meta.topicPresets : [];
      const matchedPreset = firstTopic && presets.length
        ? presets.find(item => str(item.id) === str(firstTopic.preset))
          ?? presets.find(item => str(item.label) === str(firstTopic.label))
          ?? null
        : null;

      const save = async () => {
        if (!draft) return;
        setBusy(true);
        setStatus({ kind: "loading", text: "正在保存…" });
        try {
          const wanted = draft.delivery?.mode ?? "file";
          const value = await bridge("save", { settings: draft });
          adopt(value);
          if (value?.settings?.delivery?.mode !== wanted) {
            setStale(true);
            setStatus({ kind: "error", text: "保存的交付方式被正在运行的旧版服务端丢弃了，请重启 Host 后再保存" });
          } else {
            setStatus({ kind: "ok", text: "已保存" });
          }
        } catch (error) {
          setStatus({ kind: "error", text: `保存失败：${error.message}` });
        } finally {
          setBusy(false);
        }
      };

      const reset = async () => {
        if (typeof confirm === "function" && !confirm("清空所有自定义项并恢复默认设置？")) return;
        setBusy(true);
        try {
          const value = await bridge("reset");
          adopt(value);
          setStatus({ kind: "ok", text: "已恢复默认设置" });
        } catch (error) {
          setStatus({ kind: "error", text: `清空失败：${error.message}` });
        } finally {
          setBusy(false);
        }
      };

      const rollback = async id => {
        if (typeof confirm === "function" && !confirm("回退到这个历史版本？")) return;
        setBusy(true);
        try {
          const value = await bridge("rollback", { id });
          adopt(value);
          setStatus({ kind: "ok", text: "已回退到历史版本" });
        } catch (error) {
          setStatus({ kind: "error", text: `回退失败：${error.message}` });
        } finally {
          setBusy(false);
        }
      };

      const previewBlogger = async blogger => {
        try {
          const value = await bridge("preview", { kind: "blogger", url: blogger.url, label: blogger.label });
          const queries = Array.isArray(value.queries) ? value.queries : [];
          setStatus({ kind: "ok", text: `会发 ${queries.length} 条查询：${queries.join(" / ")}` });
        } catch (error) {
          setStatus({ kind: "error", text: `预览失败：${error.message}` });
        }
      };

      const startCookie = async site => {
        setBusy(true);
        try {
          await bridge("cookie/start", { site });
          const value = await bridge("cookie/status");
          setCookie(current => ({ ...current, masked: value.masked ?? current.masked, status: value.status ?? current.status }));
          setStatus({ kind: "ok", text: "已打开登录窗口，完成登录后会自动保存" });
        } catch (error) {
          setStatus({ kind: "error", text: `捕获失败：${error.message}` });
        } finally {
          setBusy(false);
        }
      };

      const clearCookie = async site => {
        setBusy(true);
        try {
          const value = await bridge("cookie/clear", { site });
          setCookie(current => ({ ...current, masked: value.masked ?? current.masked }));
          setStatus({ kind: "ok", text: "已清除该站点的 Cookie" });
        } catch (error) {
          setStatus({ kind: "error", text: `清除失败：${error.message}` });
        } finally {
          setBusy(false);
        }
      };

      const cancelCookie = async () => {
        try {
          await bridge("cookie/cancel");
          setCookie(current => ({ ...current, status: { state: "idle" } }));
        } catch { /* ignore */ }
      };

      const refreshCookie = async () => {
        try {
          const value = await bridge("cookie/status");
          setCookie(current => ({ ...current, masked: value.masked ?? current.masked, status: value.status ?? current.status }));
        } catch { /* ignore */ }
      };

      const d = draft ?? EMPTY;
      const preset = matchedPreset;
      return h("div", { className: `tdr-card${page ? " tdr-cardPage" : ""}` },
        h("style", { key: "css" }, CSS.join("\n")),
        h("header", { className: "tdr-head", key: "head" },
          h("div", null,
            h("h2", { className: "tdr-title" }, "DSH-Search-Contrl"),
            h("p", { className: "tdr-sub" }, "按主题检索并生成中文日报/周报/月报：主题决定站点，不再默认科技。")),
          h("div", { className: "tdr-ctrl" },
            h(Chip, null, `主题 ${d.topics.length} / 博主 ${d.bloggers.length}`),
            stale ? h(Chip, { kind: "warn" }, "需重启") : h(Chip, { kind: "ok" }, "就绪"))),
        h(DeliveryPanel, { key: "delivery", draft: d, meta: panelMeta, disabled, stale, onMode: value => patch({ delivery: { ...(d.delivery ?? {}), mode: value } }) }),
        h(TitlePanel, { key: "title", draft: d, disabled, preset, setDraft: patch }),
        h(TopicsPanel, { key: "topics", draft: d, meta: panelMeta, disabled, setDraft: patch }),
        h(SourcesPanel, { key: "sources", draft: d, disabled, setDraft: patch }),
        h(BloggersPanel, { key: "bloggers", draft: d, disabled, setDraft: patch, onPreview: previewBlogger }),
        h(PostPanel, { key: "post", draft: d, disabled, setDraft: patch }),
        h(CookiePanel, {
          key: "cookie",
          sites: cookie.sites,
          masked: cookie.masked,
          status: cookie.status,
          busy,
          disabled,
          onStart: startCookie,
          onCancel: cancelCookie,
          onClear: clearCookie,
          onRefresh: refreshCookie,
        }),
        h(HistoryPanel, { key: "history", history: history.length ? history : (meta?.history ?? []), busy, onRollback: rollback }),
        h("footer", { className: "tdr-foot", key: "foot" },
          h("div", { className: `tdr-note${status.kind === "error" ? " tdr-err" : status.kind === "ok" ? " tdr-ok" : ""}` }, status.text),
          h("div", { className: "tdr-footBtns" },
            h(Btn, { disabled: busy, onClick: load }, "重新读取"),
            h(Btn, { kind: "danger", disabled: busy, onClick: reset }, "清空自定义项"),
            h(Btn, { kind: "primary", disabled: busy || !dirty, onClick: save }, busy ? "处理中…" : dirty ? "保存" : "已保存"))));
    }

    /* ---------- slots ---------- */

    const inject = ["slots"];
    const SECTION_ORDER = 152;
    const SECTION_ID = "search-contrl-settings";
    const SECTION_LABEL = "搜索控制";
    const ROW_KEY = "dsh-search-contrl#search-contrl";

    function summaryText(meta) {
      const topics = Array.isArray(meta?.value?.settings?.topics) ? meta.value.settings.topics.length : null;
      return `DSH-Search-Contrl · 主题 ${topics === null ? "?" : topics} 个 · 报告标题可自定义 · 输出方式 / 搜索源 / 博主 / 登录 Cookie / 版本回退`;
    }

    function apply(ctx) {
      if (!ctx?.slots?.register) return;
      ctx.slots.inject("settings.section", () => {
        ctx.slots.register(
          { name: "settings.section", id: SECTION_ID, label: SECTION_LABEL, order: SECTION_ORDER },
          () => h(SettingsCard, { page: true }),
        );
      });
      ctx.slots.inject("plugins.row.config", () => {
        ctx.slots.register(
          { name: "plugins.row.config", key: ROW_KEY },
          props => (props && props.view === "summary" ? summaryText(props) : h(SettingsCard, {})),
        );
      });
    }

    return { apply, inject, SettingsCard, CookiePanel, describeLink, HistoryPanel };
  },
});
