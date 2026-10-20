// Busca as notícias dos feeds RSS e grava em news.json.
// Roda sozinho no GitHub a cada hora. Não usa IA nem bibliotecas externas.
import { readFile, writeFile } from 'node:fs/promises';

const POR_TEMA = 40;          // quantas notícias guardar por tema
const DIAS_MAX = 7;           // descarta notícias mais velhas que isso
const RESUMO_MAX = 240;       // tamanho máximo do resumo

const cfg = JSON.parse(await readFile(new URL('../feeds.json', import.meta.url), 'utf8'));

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', ndash: '–', mdash: '—', laquo: '«', raquo: '»', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’' };
function decode(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);
}
function unCdata(s) { return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'); }
function texto(s) {
  if (!s) return '';
  let t = unCdata(s);
  t = decode(t);                       // alguns feeds mandam o HTML "escapado"
  t = t.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ');
  t = decode(t).replace(/\s+/g, ' ').trim();
  return t;
}
function tag(bloco, nome) {
  const m = bloco.match(new RegExp(`<${nome}(?:\\s[^>]*)?>([\\s\\S]*?)</${nome}>`, 'i'));
  return m ? m[1] : '';
}
function linkAtom(bloco) {
  const alt = bloco.match(/<link\b[^>]*rel=["']alternate["'][^>]*>/i) || bloco.match(/<link\b[^>]*href=[^>]*>/i);
  const href = alt && alt[0].match(/href=["']([^"']+)["']/i);
  return href ? decode(href[1]) : '';
}
function cortar(s, n) {
  if (s.length <= n) return s;
  const c = s.slice(0, n);
  return c.slice(0, c.lastIndexOf(' ') > n * 0.6 ? c.lastIndexOf(' ') : n).replace(/[\s,.;:–-]+$/, '') + '…';
}

export function lerFeed(xml) {
  const itens = [];
  const blocos = xml.match(/<item\b[\s\S]*?<\/item>/gi) || xml.match(/<entry\b[\s\S]*?<\/entry>/gi) || [];
  for (const b of blocos) {
    const title = texto(tag(b, 'title'));
    let url = texto(tag(b, 'link')) || linkAtom(b) || texto(tag(b, 'guid'));
    const desc = tag(b, 'description') || tag(b, 'summary') || tag(b, 'content') || tag(b, 'content:encoded');
    const quando = texto(tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date'));
    const t = Date.parse(quando);
    if (!title || !/^https?:\/\//.test(url)) continue;
    let summary = texto(desc).replace(/\s*(O post|The post) .*? (apareceu primeiro em|appeared first on) .*$/i, '').replace(/\s*(Continue reading|Leia mais|Read more)\.*…?\s*$/i, '');
    if (summary.toLowerCase().startsWith(title.toLowerCase())) summary = summary.slice(title.length).replace(/^[\s.:;,–—-]+/, '').trim();
    itens.push({ title, url, summary: cortar(summary, RESUMO_MAX), ts: Number.isFinite(t) ? t : null });
  }
  return itens;
}

async function baixar(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, redirect: 'follow', headers: { 'user-agent': 'RadarDiario/1.0 (+leitor RSS pessoal)', accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    // alguns feeds brasileiros (ex.: Folha) vêm em ISO-8859-1, não em UTF-8
    const buf = Buffer.from(await r.arrayBuffer());
    const head = buf.subarray(0, 200).toString('latin1');
    const cs = (head.match(/encoding=["']([\w-]+)["']/i)?.[1] || (r.headers.get('content-type') || '').match(/charset=([\w-]+)/i)?.[1] || 'utf-8').toLowerCase();
    try { return new TextDecoder(cs).decode(buf); } catch { return buf.toString('utf8'); }
  } finally { clearTimeout(timer); }
}

async function main() {
  const agora = Date.now();
  const limite = agora - DIAS_MAX * 864e5;
  const cache = new Map();
  const fontes = [];
  const porTema = {};

  for (const f of cfg.feeds) {
    try {
      if (!cache.has(f.url)) cache.set(f.url, baixar(f.url).then(lerFeed));
      let itens = await cache.get(f.url);
      if (f.filter) { const re = new RegExp(f.filter, 'i'); itens = itens.filter(i => re.test(i.title + ' ' + i.summary)); }
      itens = itens.filter(i => !i.ts || i.ts >= limite).map(i => ({ ...i, ts: i.ts ?? agora, source: f.name, cat: f.cat }));
      (porTema[f.cat] ??= []).push(...itens);
      fontes.push({ name: f.name, cat: f.cat, ok: true, n: itens.length });
    } catch (e) {
      fontes.push({ name: f.name, cat: f.cat, ok: false, erro: String(e.message || e) });
      console.warn(`Falhou: ${f.name} (${f.url}) – ${e.message || e}`);
    }
  }

  // uma mesma notícia aparece só uma vez dentro do tema
  const articles = [];
  for (const [cat, lista] of Object.entries(porTema)) {
    const vistos = new Set();
    lista.sort((a, b) => b.ts - a.ts);
    for (const i of lista) {
      const chave = i.url.replace(/[?#].*$/, '');
      const chaveT = i.title.toLowerCase().replace(/\W+/g, '');
      if (vistos.has(chave) || vistos.has(chaveT)) continue;
      vistos.add(chave); vistos.add(chaveT);
      articles.push({ id: cat + '-' + hash(chave), ...i });
      if (articles.filter(a => a.cat === cat).length >= POR_TEMA) break;
    }
  }

  const ok = fontes.filter(f => f.ok).length;
  console.log(`${articles.length} notícias de ${ok}/${fontes.length} fontes.`);
  if (!articles.length) { console.error('Nenhuma notícia: mantendo o arquivo anterior.'); process.exit(0); }
  await writeFile(new URL('../news.json', import.meta.url), JSON.stringify({ updatedAt: agora, fontes, articles }));
}

function hash(s) { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.codePointAt(0), 16777619); return (h >>> 0).toString(36); }

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) await main();
