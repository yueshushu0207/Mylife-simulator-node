/* ============================================================
 * seo.js — 站点 SEO 元信息（单一数据源）
 *
 * 用途：
 *  1. server.js 启动时把 META_HTML 注入 index.html 的 <!--SEO_META--> 占位符
 *  2. 提供 /robots.txt 与 /sitemap.xml 的动态生成
 *
 * 部署上线时建议设置环境变量：
 *  SITE_URL=https://your-domain.com   （canonical / sitemap 用到）
 *  SITE_ICON=/favicon.svg             （可选，默认 /favicon.svg）
 *
 * 关键词策略：
 *  - 功能词：人生模拟器、人生重开模拟器、文字版人生、八字排盘、AI 人生模拟……
 *  - 品牌词：金亥跃江（个人品牌 / 公众号「金亥跃江聊量化」）
 *  - 作者词：岳泽霖
 * ============================================================ */
'use strict';

const SITE_URL = (process.env.SITE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const VERSION = process.env.SITE_VERSION || '1.3.0';

const SITE = {
  name: '人生模拟器',
  fullName: '人生模拟器 · 文字版',
  alternateName: ['人生重开模拟器', '八字人生模拟', 'AI 文字人生游戏'],
  author: '岳泽霖',
  brand: '金亥跃江',
  publisher: '金亥跃江',
  siteUrl: SITE_URL,
  version: VERSION,
  lang: 'zh-CN',
  locale: 'zh_CN',
  themeColor: '#c9a227',
  description:
    '输入生辰八字，AI 为你排盘并锁定时代背景，从降生到暮年走完一生：' +
    '1949 年至今十二个年代的风貌、物价与观念都真实还原，每一次盲选都在改写七维属性。' +
    '国产国之重器 DeepSeek 大模型实时生成，出品：金亥跃江，作者：岳泽霖。',
  keywords: [
    // —— 功能词（核心业务） ——
    '人生模拟器', '人生重开模拟器', '人生模拟器在线玩', '文字版人生模拟器',
    '人生模拟游戏', '重开人生', '模拟人生', '人生重开', '命运模拟器',
    '八字排盘', '生辰八字', '四柱八字', '八字算命', '日主', '五行',
    'AI 人生模拟', 'AI 文字冒险', 'DeepSeek', '大模型游戏',
    '怀旧年代', '七八十年代', '时代风貌', '命运抉择',
    // —— 品牌 / 作者词 ——
    '岳泽霖', '金亥跃江', '金亥跃江聊量化'
  ],
  features: [
    '生辰八字定时代背景', 'AI 实时生成剧情', '七维属性盲选', '多结局人生图鉴'
  ]
};

/* ---------------- 静态 meta 片段（注入 index.html head） ---------------- */
function buildMetaHtml() {
  const kw = SITE.keywords.join(',');
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');

  return [
    `<title>${esc(SITE.fullName)}</title>`,
    `<meta name="description" content="${esc(SITE.description)}" />`,
    `<meta name="keywords" content="${esc(kw)}" />`,
    `<meta name="author" content="${esc(SITE.author)}（${esc(SITE.brand)}）" />`,
    `<meta name="creator" content="${esc(SITE.author)}" />`,
    `<meta name="publisher" content="${esc(SITE.brand)}" />`,
    `<meta name="application-name" content="${esc(SITE.name)}" />`,
    `<meta name="robots" content="index,follow,max-image-preview:large" />`,
    `<meta name="googlebot" content="index,follow" />`,
    `<meta name="baidu-site-verification" content="replace-with-your-baidu-code" />`,
    `<meta name="generator" content="${esc(SITE.fullName)} v${esc(SITE.version)}" />`,
    `<meta name="theme-color" content="${SITE.themeColor}" />`,
    `<meta name="format-detection" content="telephone=no" />`,
    `<link rel="canonical" href="${SITE.siteUrl}/" />`,
    `<link rel="icon" type="image/svg+xml" href="/favicon.svg" />`,
    `<link rel="apple-touch-icon" href="/favicon.svg" />`,
    // Open Graph
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${esc(SITE.fullName)}" />`,
    `<meta property="og:locale" content="${SITE.locale}" />`,
    `<meta property="og:title" content="${esc(SITE.fullName)} · 输入八字，重启一生" />`,
    `<meta property="og:description" content="${esc(SITE.description)}" />`,
    `<meta property="og:url" content="${SITE.siteUrl}/" />`,
    `<meta property="og:image" content="${SITE.siteUrl}/og-image.png" />`,
    // Twitter
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(SITE.fullName)}" />`,
    `<meta name="twitter:description" content="${esc(SITE.description)}" />`,
    `<meta name="twitter:image" content="${SITE.siteUrl}/og-image.png" />`,
    `<meta name="twitter:creator" content="@${esc(SITE.brand)}" />`,
    // 结构化数据
    buildJsonLdScript()
  ].join('\n  ');
}

/* ---------------- JSON-LD 结构化数据 ---------------- */
function buildJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        '@id': SITE.siteUrl + '/#website',
        name: SITE.fullName,
        alternateName: SITE.alternateName,
        url: SITE.siteUrl + '/',
        description: SITE.description,
        inLanguage: SITE.lang,
        keywords: SITE.keywords.join(','),
        publisher: { '@id': SITE.siteUrl + '/#organization' },
        potentialAction: {
          '@type': 'SearchAction',
          target: { '@type': 'EntryPoint', urlTemplate: SITE.siteUrl + '/?q={search_term_string}' },
          'query-input': 'required name=search_term_string'
        }
      },
      {
        '@type': 'WebApplication',
        '@id': SITE.siteUrl + '/#app',
        name: SITE.fullName,
        alternateName: SITE.alternateName,
        url: SITE.siteUrl + '/',
        applicationCategory: 'GameApplication',
        operatingSystem: 'Web Browser',
        browserRequirements: 'Requires JavaScript',
        softwareVersion: SITE.version,
        description: SITE.description,
        inLanguage: SITE.lang,
        isAccessibleForFree: true,
        featureList: SITE.features,
        keywords: SITE.keywords.join(','),
        author: { '@id': SITE.siteUrl + '/#author' },
        creator: { '@id': SITE.siteUrl + '/#author' },
        publisher: { '@id': SITE.siteUrl + '/#organization' },
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'CNY' }
      },
      {
        '@type': 'Person',
        '@id': SITE.siteUrl + '/#author',
        name: SITE.author,
        alternateName: [SITE.brand],
        knowsAbout: ['人生模拟', '八字排盘', 'AI 应用开发', 'Node.js', '量化投资'],
        url: SITE.siteUrl + '/'
      },
      {
        '@type': 'Organization',
        '@id': SITE.siteUrl + '/#organization',
        name: SITE.brand,
        alternateName: [SITE.author],
        url: SITE.siteUrl + '/',
        founder: { '@id': SITE.siteUrl + '/#author' }
      }
    ]
  };
}

function buildJsonLdScript() {
  return '<script type="application/ld+json">\n  '
    + JSON.stringify(buildJsonLd(), null, 2).replace(/\n/g, '\n  ')
    + '\n  </script>';
}

/* ---------------- robots.txt ---------------- */
function robotsTxt() {
  return [
    '# robots.txt for ' + SITE.fullName,
    '# 出品：' + SITE.brand + ' · 作者：' + SITE.author,
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/',
    'Disallow: /data/',
    'Disallow: /.env',
    '',
    'Sitemap: ' + SITE.siteUrl + '/sitemap.xml',
    ''
  ].join('\n');
}

/* ---------------- sitemap.xml ---------------- */
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function xmlEscape(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function sitemapXml(pages) {
  const list = (pages && pages.length) ? pages : [
    { loc: SITE.siteUrl + '/', priority: '1.0', changefreq: 'weekly' }
  ];
  const date = todayISO();
  const body = list.map(p => [
    '  <url>',
    `    <loc>${xmlEscape(p.loc)}</loc>`,
    `    <lastmod>${p.lastmod || date}</lastmod>`,
    `    <changefreq>${p.changefreq || 'weekly'}</changefreq>`,
    `    <priority>${p.priority || '0.8'}</priority>`,
    '  </url>'
  ].join('\n')).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- 出品：${SITE.brand} · 作者：${SITE.author} -->
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>
`;
}

module.exports = {
  SITE,
  META_HTML: buildMetaHtml(),
  jsonLd: buildJsonLd,
  robotsTxt,
  sitemapXml
};
