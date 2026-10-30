/**
 * Topic presets: the source plan that replaces the old hard-coded technology list.
 *
 * 3.0.0 removed the "always search technology" default. Nothing is collected until a
 * topic is known: the skill asks the user which topic to report on, and this table
 * maps that topic to concrete channels (RSS feeds, site domains, query seeds). A
 * topic nobody wrote a preset for still works — the caller simply gets no feeds and
 * falls back to live search, which is the honest default for an unknown domain.
 */

/** @typedef {{ id: string, url: string, lang: string, note: string }} Feed */
/** @typedef {{ id: string, label: string, aliases: RegExp, keywords: string[], domains: string[], queries: string[], feeds: Feed[], boards: Record<string, RegExp[]> }} TopicPreset */

/** @type {TopicPreset[]} */
export const TOPIC_PRESETS = [
  {
    id: 'tech',
    label: '科技',
    aliases: /科技|互联网|数码|AI|人工智能|芯片|手机|大模型|IT/i,
    keywords: ['人工智能', '大模型', '芯片', '手机', '半导体', '消费电子'],
    domains: ['ithome.com', '36kr.com', 'infoq.cn', 'theverge.com', 'techcrunch.com'],
    queries: ['科技 新品 发布', '人工智能 大模型 发布', '芯片 半导体 量产'],
    feeds: [
      { id: 'ithome', url: 'https://www.ithome.com/rss/', lang: 'zh', note: 'IT之家：手机/芯片/AI 综合' },
      { id: 'leiphone', url: 'https://www.leiphone.com/feed', lang: 'zh', note: '雷锋网：AI/产业/车企' },
      { id: 'ifanr', url: 'https://www.ifanr.com/feed', lang: 'zh', note: '爱范儿：手机/汽车/早报' },
      { id: 'tmtpost', url: 'https://www.tmtpost.com/rss', lang: 'zh', note: '钛媒体：产业/科技商业' },
      { id: '36kr', url: 'https://www.36kr.com/feed', lang: 'zh', note: '36氪：商业/创投/AI 应用' },
      { id: 'infoq', url: 'https://www.infoq.cn/feed', lang: 'zh', note: 'InfoQ 中国：开发/AI 工程/架构' },
      { id: 'geekpark', url: 'https://www.geekpark.net/rss', lang: 'zh', note: '极客公园：科技产业/访谈' },
      { id: 'sspai', url: 'https://sspai.com/feed', lang: 'zh', note: '少数派：软件/效率' },
      { id: 'verge', url: 'https://www.theverge.com/rss/index.xml', lang: 'en', note: 'The Verge：科技综合' },
      { id: 'techcrunch', url: 'https://techcrunch.com/feed/', lang: 'en', note: 'TechCrunch：AI/创业' },
    ],
    boards: {
      国内车型: [/比亚迪|蔚来|小鹏|理想汽车|问界|鸿蒙智行|极氪|零跑|小米汽车|长城汽车|吉利|奇瑞|上汽|广汽|智界|享界|尊界|阿维塔|岚图|哪吒|腾势|方程豹|魏牌|坦克|捷途|五菱|新车发布|交付量|智驾/i],
      国内手机: [/华为|小米|荣耀|OPPO|vivo|魅族|一加|真我|努比亚|红米|REDMI|鸿蒙|HarmonyOS|折叠屏|新机|国行|Mate|Pura|nova/i],
      芯片半导体: [/芯片|半导体|台积电|TSMC|英伟达|NVIDIA|AMD|Intel|英特尔|光刻|晶圆|HBM|存储芯|3nm|2nm|ASML|高通|联发科|骁龙|天玑|晶圆厂/i],
      国内AI: [/大模型|模型发布|开源模型|DeepSeek|智谱|月之暗面|Kimi|通义|豆包|混元|文心|讯飞|MiniMax|阶跃|商汤|Qwen|GLM|百度世界|阿里云|火山引擎/i],
      国际AI: [/OpenAI|ChatGPT|Anthropic|Claude|Gemini|DeepMind|Meta AI|Llama|xAI|Grok|Mistral|Copilot|Hugging Face/i],
      国际车型: [/Tesla|特斯拉|Toyota|BMW|Mercedes|Porsche|Rivian|Lucid|Waymo|Electric Vehicle|Cybertruck|FSD|Hyundai|Ford|GM\b|Volkswagen/i],
      航天与科学: [/航天|火箭|卫星|NASA|SpaceX|星舰|登月|探测器|望远镜|量子计算|核聚变|太空|运载|遥感|空间站|嫦娥|天问|论文|Nature\b|Science\b/i],
      网络安全: [/漏洞|CVE-|勒索|数据泄露|黑客|零日|DDoS|APT攻击|安全公告|网络攻击/i],
      产业政策: [/政策|监管|备案|工信部|网信办|反垄断|关税|法规|白皮书|国家标准|行业标准|征求意见稿|试点|补贴政策/i],
    },
  },
  {
    id: 'finance',
    label: '财经',
    aliases: /财经|金融|股市|A股|美股|宏观|经济|投资|基金|债券|汇率|银行/i,
    keywords: ['A股', '美股', '央行', '利率', '财报', '并购'],
    domains: ['wallstreetcn.com', 'caixin.com', 'eastmoney.com', 'cls.cn', 'reuters.com', 'bloomberg.com'],
    queries: ['财经 要闻 今日', 'A股 收盘 涨跌', '央行 利率 政策 公告'],
    feeds: [],
    boards: {
      市场行情: [/沪指|上证指数|深证成指|创业板|恒生|纳斯达克|标普|道琼斯|收盘|涨跌|涨停|跌停|汇率|国债/i],
      宏观与政策: [/央行|降准|降息|LPR|财政部|国常会|统计局|CPI|PPI|GDP|赤字|专项债|关税/i],
      公司与融资: [/财报|营收|净利|IPO|上市|并购|重组|定增|回购|减持|私有化|估值|融资/i],
      加密与大宗: [/比特币|以太坊|加密货币|黄金|原油|期货|铜价|锂价/i],
    },
  },
  {
    id: 'auto',
    label: '汽车',
    aliases: /汽车|车型|新能源车|电动车|车企|智驾|自动驾驶/i,
    keywords: ['新车', '交付量', '智驾', '电池', '车企'],
    domains: ['autohome.com.cn', 'dongchedi.com', 'gasgoo.com', 'electrek.co', 'insideevs.com'],
    queries: ['新能源汽车 上市 交付', '车企 销量 财报', '智驾 自动驾驶 发布'],
    feeds: [
      { id: 'electrek', url: 'https://electrek.co/feed/', lang: 'en', note: 'Electrek：电动车/国际车型' },
      { id: 'insideevs', url: 'https://insideevs.com/feed/', lang: 'en', note: 'InsideEVs：国际车型' },
    ],
    boards: {
      国内新车: [/比亚迪|蔚来|小鹏|理想|问界|极氪|零跑|小米汽车|长城|吉利|奇瑞|上汽|广汽|阿维塔|岚图|腾势|上市|交付|售价/i],
      国际新车: [/Tesla|特斯拉|Toyota|BMW|Mercedes|Rivian|Lucid|Ford|GM\b|Hyundai|Volkswagen|Cybertruck|FSD/i],
      智驾与补能: [/智驾|自动驾驶|城市NOA|激光雷达|超充|换电|充电桩|快充|固态电池/i],
      产业链: [/锂|电池|宁德时代|电机|电控|产能|工厂|供应链|召回|碰撞测试/i],
    },
  },
  {
    id: 'sports',
    label: '体育',
    aliases: /体育|足球|篮球|NBA|奥运|赛事|世界杯|中超|CBA/i,
    keywords: ['赛事', '比分', '转会', '冠军', '奥运'],
    domains: ['hupu.com', 'espn.com', 'sports.sina.com.cn', 'olympics.com'],
    queries: ['体育 赛事 结果 今日', '转会 官宣 签约', '决赛 冠军 夺冠'],
    feeds: [],
    boards: {
      足球: [/英超|西甲|意甲|德甲|中超|欧冠|世界杯|梅西|C罗|皇马|巴萨|曼联|利物浦|国足/i],
      篮球: [/NBA|CBA|湖人|勇士|凯尔特人|约基奇|詹姆斯|库里|季后赛|总决赛/i],
      综合与奥运: [/奥运|田径|游泳|网球|羽毛球|乒乓球|马拉松|F1|赛车|拳击|滑雪/i],
      赛事与人事: [/转会|签约|解约|主帅|教练|退役|禁赛|兴奋剂|伤病/i],
    },
  },
  {
    id: 'entertainment',
    label: '娱乐',
    aliases: /娱乐|明星|影视|综艺|票房|剧集|电影|音乐/i,
    keywords: ['定档', '票房', '开播', '综艺', '演唱会'],
    domains: ['douban.com', 'weibo.com', 'variety.com', 'maoyan.com'],
    queries: ['影视 定档 上映 票房', '综艺 开播 首播', '演唱会 官宣'],
    feeds: [],
    boards: {
      影视: [/定档|上映|票房|导演|剧组|杀青|预告片|电影院|Netflix|院线/i],
      综艺与音乐: [/综艺|首播|嘉宾|演唱会|专辑|单曲|音乐节|巡演/i],
      明星与舆情: [/官宣|恋情|结婚|离婚|致歉|回应|热搜|塌房|解约/i],
    },
  },
  {
    id: 'health',
    label: '医疗健康',
    aliases: /医疗|健康|医药|新药|临床|生物|疫苗|医院/i,
    keywords: ['新药', '临床', '获批', '集采', '疫苗'],
    domains: ['dxy.cn', 'nmpa.gov.cn', 'nature.com', 'statnews.com', 'who.int'],
    queries: ['新药 获批 上市 临床', '医疗器械 集采 医保', '疫苗 公共卫生 通报'],
    feeds: [],
    boards: {
      药物与临床: [/新药|获批|临床|III期|适应症|FDA|NMPA|医保|集采|仿制药/i],
      器械与诊断: [/器械|影像|检测|试剂|手术机器人|体外诊断|IVD/i],
      公卫与政策: [/疫苗|疫情|流感|公共卫生|疾控|分级诊疗|医院|医师/i],
    },
  },
  {
    id: 'game',
    label: '游戏',
    aliases: /游戏|手游|主机|电竞|Steam|PS5|Switch/i,
    keywords: ['新游', '公测', '版号', '电竞', '主机'],
    domains: ['gamersky.com', 'gcores.com', 'ign.com', 'taptap.cn'],
    queries: ['新游 上线 公测', '游戏 版号 过审', '电竞 赛事 冠军'],
    feeds: [],
    boards: {
      新游发布: [/上线|公测|首发|定档|Steam|版号|预约|测试服/i],
      厂商动态: [/腾讯|网易|米哈游|索尼|任天堂|微软|育碧|EA\b|暴雪|收购|裁员/i],
      电竞与赛事: [/电竞|KPL|LPL|S赛|TI\b|冠军|战队|选手/i],
    },
  },
  {
    id: 'policy',
    label: '时政政策',
    aliases: /政策|时政|政务|监管|法规|两会|部委/i,
    keywords: ['政策', '监管', '国务院', '部委', '法规'],
    domains: ['gov.cn', 'news.cn', 'people.com.cn', 'thepaper.cn'],
    queries: ['国务院 常务会议 部署', '部委 发布 通知 办法', '政策 征求意见 落地'],
    feeds: [],
    boards: {
      中央与部委: [/国务院|国常会|部委|发改委|工信部|财政部|央行|网信办|市场监管总局/i],
      地方与经济: [/省政府|市政府|试点|自贸区|专项债|营商环境|就业|消费/i],
      国际关系: [/外交部|会谈|制裁|关税|联合声明|峰会|访问/i],
    },
  },
  {
    id: 'energy',
    label: '能源',
    aliases: /能源|光伏|风电|储能|电网|电力|核电|双碳/i,
    keywords: ['光伏', '储能', '电网', '电价', '双碳'],
    domains: ['bjx.com.cn', 'chinasmartgrid.com.cn', 'electrek.co'],
    queries: ['光伏 储能 装机 中标', '电网 电价 政策', '核电 风电 项目 开工'],
    feeds: [],
    boards: {
      光伏风电: [/光伏|组件|硅料|风机|风电|装机|逆变器/i],
      储能与电网: [/储能|电池|电网|特高压|调峰|电价|电力市场/i],
      政策与项目: [/双碳|核准|开工|并网|补贴|配额|绿证/i],
    },
  },
  {
    id: 'science',
    label: '科学',
    aliases: /科学|航天|天文|物理|生物|论文|太空|量子/i,
    keywords: ['航天', '论文', '量子', '天文', '核聚变'],
    domains: ['solidot.org', 'arstechnica.com', 'nasa.gov', 'space.com', 'nature.com'],
    queries: ['航天 发射 任务 成功', '科学 论文 突破 研究', '量子 核聚变 实验'],
    feeds: [
      { id: 'solidot', url: 'https://www.solidot.org/index.rss', lang: 'zh', note: 'Solidot：科学/安全/开源' },
      { id: 'ars', url: 'https://feeds.arstechnica.com/arstechnica/index', lang: 'en', note: 'Ars Technica：科学/航天/安全' },
    ],
    boards: {
      航天: [/NASA|SpaceX|星舰|火箭|卫星|空间站|嫦娥|天问|探测器|发射|登月/i],
      物理与天文: [/量子|核聚变|超导|粒子|引力波|望远镜|黑洞|暗物质/i],
      生命科学: [/论文|Nature|Science|基因|细胞|病毒|疫苗|脑科学/i],
    },
  },
];

/** @returns {TopicPreset[]} */
export function listTopicPresets() {
  return TOPIC_PRESETS;
}

/**
 * Compact view for the settings bridge: the GUI cannot import this module (it is a
 * browser bundle), so describe() ships the table the page needs to offer presets.
 */
export function presetCatalog() {
  return TOPIC_PRESETS.map(item => ({
    id: item.id,
    label: item.label,
    keywords: item.keywords.slice(0, 6),
    domains: item.domains.slice(0, 6),
    feeds: item.feeds.length,
  }));
}

/**
 * Match free text (a user's topic name, or their keywords) against the table.
 * First hit wins; the table order is the priority order.
 *
 * @param {unknown} text
 * @returns {TopicPreset | null}
 */
export function matchPreset(text) {
  const hay = typeof text === 'string' ? text.trim() : '';
  if (hay === '') return null;
  const lower = hay.toLowerCase();
  for (const preset of TOPIC_PRESETS) {
    if (preset.label === hay) return preset;
    if (preset.aliases.test(hay)) return preset;
    if (preset.keywords.some(word => hay.includes(word))) return preset;
    // A pasted site ("electrek.co") is the third documented match path: the user
    // names a source instead of a topic, and that still picks the right preset.
    if (preset.domains.some(domain => domain && lower.includes(domain))) return preset;
  }
  return null;
}

/**
 * Resolve the preset for a settings topic entry (label, keywords, domains).
 * An explicitly configured topic can also pin the preset with a "preset" field.
 *
 * @param {{ label?: string, keywords?: string[], domains?: string[], preset?: string } | null | undefined} topic
 * @returns {TopicPreset | null}
 */
export function presetForTopic(topic) {
  if (!topic || typeof topic !== 'object') return null;
  const pinned = typeof topic.preset === 'string' ? topic.preset.trim() : '';
  if (pinned) {
    const byId = TOPIC_PRESETS.find(item => item.id === pinned);
    if (byId) return byId;
  }
  const label = typeof topic.label === 'string' ? topic.label : '';
  const keywords = Array.isArray(topic.keywords) ? topic.keywords.join(' ') : '';
  const domains = Array.isArray(topic.domains) ? topic.domains.join(' ') : '';
  return matchPreset(label) || matchPreset(keywords) || matchPreset(domains);
}

/**
 * Feeds for a preset, or an empty list when the topic has no known sources.
 * Callers must handle the empty case by searching instead of collecting.
 *
 * @param {TopicPreset | null} preset
 * @returns {Feed[]}
 */
export function feedsForPreset(preset) {
  return preset && Array.isArray(preset.feeds) ? preset.feeds.slice() : [];
}

/**
 * Board rules for a preset. An unknown topic gets no boards at all, which makes the
 * collector emit one flat candidate list instead of inventing technology sections.
 *
 * @param {TopicPreset | null} preset
 * @returns {Record<string, RegExp[]>}
 */
export function boardsForPreset(preset) {
  return preset && preset.boards ? preset.boards : {};
}
