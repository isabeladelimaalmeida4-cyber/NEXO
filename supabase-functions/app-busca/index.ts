// Função "app-busca" — busca de empresas para o App de Vendas (consultoras logadas).
// Mesma fonte e mesma base da função "busca-cnpj" (tabela public.empresas), sem alterá-la.
// Só aceita usuárias com cadastro ativo em public.app_consultoras.
//   { action: "search", filtros }  → pesquisa na Receita (Casa dos Dados), busca contatos, salva e devolve
//        filtros.preset = "barbearias" | "consultoras" aplica os filtros prontos do servidor
//        filtros.abertura_ate = proximo_ate devolvido na busca anterior → traz as próximas 20 (mais antigas)
//   { action: "base", filtros, pagina, por_pagina, ordem } → consulta a base já salva
//   { action: "stats" } → números da base   |   { action: "cnpj", cnpj } → ficha de um CNPJ
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const CASA_DOS_DADOS = "https://api.casadosdados.com.br/v5/public/cnpj/pesquisa";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const norm = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const digits = (s: unknown) => String(s ?? "").replace(/\D/g, "");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isoDaysAgo = (d: number) => new Date(Date.now() - d * 864e5).toISOString().slice(0, 10);
const isDate = (s: unknown) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const dayBefore = (s: string) => new Date(Date.parse(s + "T12:00:00Z") - 864e5).toISOString().slice(0, 10);
const strList = (v: unknown, re?: RegExp) =>
  (Array.isArray(v) ? v : v ? [v] : []).map((x) => String(x).trim()).filter((x) => x && (!re || re.test(x))).slice(0, 30);

// Filtros prontos. Os termos ficam só aqui no servidor.
const PRESETS: Record<string, { cnae: string[]; secundaria?: boolean; mei?: string; textos?: string[]; base?: (q: any) => any }> = {
  // barbearias: o CNAE 9602-5/01 junta salão, barbearia e manicure; o nome separa as barbearias
  barbearias: {
    cnae: ["9602501"],
    textos: ["barbearia", "barbearias", "barber", "barbershop", "barbeiro"],
    base: (q) => q.in("cnae", ["9602501"]).or("razao.ilike.*barbear*,fantasia.ilike.*barbear*,razao.ilike.*barber*,fantasia.ilike.*barber*,razao.ilike.*barbeiro*,fantasia.ilike.*barbeiro*"),
  },
  // consultoras: quem revende cosméticos com CNPJ costuma ser MEI com o CNAE 4772-5/00 (principal ou secundário)
  consultoras: {
    cnae: ["4772500"], secundaria: true, mei: "sim",
    base: (q) => q.eq("cnae", "4772500").eq("mei", true),
  },
};

type Filtros = {
  uf: string[]; municipio: string[]; cnae: string[]; secundaria: boolean; mei: string; simples: string;
  abertura_de?: string; abertura_ate?: string; capital_min?: number; capital_max?: number;
  com_telefone: boolean; somente_celular: boolean; com_email: boolean; somente_matriz: boolean;
  texto: string; com_contato: boolean; porte: string[]; preset: string;
};
function cleanFiltros(f: Record<string, unknown> = {}): Filtros {
  const preset = typeof f.preset === "string" && PRESETS[f.preset] ? f.preset : "";
  const out: Filtros = {
    uf: strList(f.uf, /^[A-Za-z]{2}$/).map((u) => u.toUpperCase()),
    municipio: strList(f.municipio),
    cnae: strList(f.cnae, /^\d{7}$/),
    secundaria: !!f.secundaria,
    mei: f.mei === "sim" || f.mei === "nao" ? String(f.mei) : "",
    simples: f.simples === "sim" || f.simples === "nao" ? String(f.simples) : "",
    abertura_de: isDate(f.abertura_de) ? String(f.abertura_de) : undefined,
    abertura_ate: isDate(f.abertura_ate) ? String(f.abertura_ate) : undefined,
    capital_min: Number(f.capital_min) > 0 ? Number(f.capital_min) : undefined,
    capital_max: Number(f.capital_max) > 0 ? Number(f.capital_max) : undefined,
    com_telefone: !!f.com_telefone, somente_celular: !!f.somente_celular, com_email: !!f.com_email, somente_matriz: !!f.somente_matriz,
    texto: typeof f.texto === "string" ? f.texto.trim().slice(0, 80) : "",
    com_contato: f.com_contato !== false,
    porte: strList(f.porte),
    preset,
  };
  if (preset) {
    const p = PRESETS[preset];
    out.cnae = p.cnae; out.secundaria = !!p.secundaria; if (p.mei) out.mei = p.mei;
  }
  return out;
}

function cdBody(f: Filtros) {
  const b: Record<string, unknown> = { situacao_cadastral: ["ATIVA"], limite: 20, pagina: 1 };
  if (f.cnae.length) { b.codigo_atividade_principal = f.cnae; if (f.secundaria) b.incluir_atividade_secundaria = true; }
  if (f.uf.length) b.uf = f.uf.map((u) => u.toLowerCase());
  if (f.municipio.length) b.municipio = f.municipio.map(norm);
  if (f.mei === "sim") b.mei = { optante: true }; else if (f.mei === "nao") b.mei = { excluir_optante: true };
  if (f.simples === "sim") b.simples = { optante: true }; else if (f.simples === "nao") b.simples = { excluir_optante: true };
  let ate = f.abertura_ate;
  // cadastros abertos há menos de 2 meses ainda não têm contato nas bases públicas
  if (f.com_contato) { const lim = isoDaysAgo(60); if (!ate || ate > lim) ate = lim; }
  if (f.abertura_de || ate) b.data_abertura = { inicio: f.abertura_de || "1900-01-01", fim: ate || isoDaysAgo(0) };
  if (f.capital_min || f.capital_max) b.capital_social = { minimo: f.capital_min || 0, maximo: f.capital_max || 1e12 };
  const mf: Record<string, boolean> = {};
  if (f.com_telefone) mf.com_telefone = true;
  if (f.somente_celular) mf.somente_celular = true;
  if (f.com_email) mf.com_email = true;
  if (f.somente_matriz) mf.somente_matriz = true;
  if (Object.keys(mf).length) b.mais_filtros = mf;
  const textos = f.texto ? [f.texto] : (f.preset && PRESETS[f.preset].textos) || [];
  if (textos.length) b.busca_textual = [{ texto: textos, tipo_busca: "exata", razao_social: true, nome_fantasia: true, nome_socio: false }];
  return b;
}
async function fetchT(url: string, init: RequestInit = {}, ms = 15000) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { ...init, signal: ctl.signal }); } finally { clearTimeout(t); }
}
async function cdSearch(body: Record<string, unknown>) {
  for (let i = 0; i < 3; i++) {
    let r: Response;
    try {
      r = await fetchT(CASA_DOS_DADOS, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": UA, Origin: "https://casadosdados.com.br", Referer: "https://casadosdados.com.br/" },
        body: JSON.stringify(body),
      }, 20000);
    } catch (e) { if (i < 2) { await sleep(1500); continue; } return { status: 504, items: [] as any[], total: 0, detail: String(e) }; }
    const text = await r.text();
    if (r.status === 429 || r.status >= 500) { await sleep(2000 * (i + 1)); continue; }
    if (!r.ok) return { status: r.status, items: [] as any[], total: 0, detail: text.slice(0, 300) };
    const d = JSON.parse(text);
    const items = d.cnpjs || d.empresas || d.data?.cnpj || (Array.isArray(d.data) ? d.data : []) || [];
    return { status: 200, items: items as Record<string, any>[], total: Number(d.total) || items.length, detail: "" };
  }
  return { status: 429, items: [] as any[], total: 0, detail: "limite de requisições da fonte" };
}
async function lookup(cnpj: string) {
  let last = 502;
  for (const url of [`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, `https://minhareceita.org/${cnpj}`]) {
    for (let i = 0; i < 2; i++) {
      try {
        const r = await fetchT(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
        if (r.status === 404) { last = 404; break; }
        if (r.ok) return { status: 200, data: await r.json() };
        last = r.status;
        if (r.status === 429) { await sleep(1500); continue; }
        break;
      } catch { last = 504; break; }
    }
  }
  return { status: last, data: null as any };
}
function rowFrom(c: string, x: Record<string, any> = {}, d: Record<string, any> | null) {
  const e = x.endereco || {}; const g = d || {};
  const pick = (...v: unknown[]) => { for (const a of v) if (a !== undefined && a !== null && a !== "") return a; return null; };
  const mun = pick(g.municipio, e.municipio, x.municipio) as string | null;
  return {
    cnpj: c,
    razao: pick(g.razao_social, x.razao_social),
    fantasia: pick(g.nome_fantasia, x.nome_fantasia),
    cnae: pick(g.cnae_fiscal ? String(g.cnae_fiscal).padStart(7, "0") : null, x.codigo_atividade_principal ? digits(x.codigo_atividade_principal) : null),
    cnae_desc: pick(g.cnae_fiscal_descricao, x.atividade_principal?.descricao),
    municipio: mun, municipio_norm: mun ? norm(mun) : null,
    uf: (pick(g.uf, e.uf, x.uf) as string | null)?.toUpperCase() ?? null,
    bairro: pick(g.bairro, e.bairro),
    logradouro: pick([g.descricao_tipo_de_logradouro, g.logradouro].filter(Boolean).join(" "), [e.tipo_logradouro, e.logradouro].filter(Boolean).join(" ")),
    numero: pick(g.numero, e.numero), complemento: pick(g.complemento, e.complemento), cep: pick(digits(g.cep), digits(e.cep)),
    tel1: pick(digits(g.ddd_telefone_1)), tel2: pick(digits(g.ddd_telefone_2)),
    email: g.email ? String(g.email).toLowerCase() : null,
    mei: pick(g.opcao_pelo_mei, x.mei?.optante), simples: pick(g.opcao_pelo_simples, x.simples?.optante),
    porte: pick(g.porte, x.porte_empresa?.descricao), natureza: pick(g.natureza_juridica, x.descricao_natureza_juridica),
    matriz: g.identificador_matriz_filial ? g.identificador_matriz_filial === 1 : (x.matriz_filial ? x.matriz_filial === "MATRIZ" : null),
    abertura: pick(g.data_inicio_atividade, x.data_abertura),
    situacao: pick(g.descricao_situacao_cadastral, x.situacao_cadastral?.situacao_cadastral, typeof x.situacao_cadastral === "string" ? x.situacao_cadastral : null),
    capital: pick(g.capital_social, x.capital_social),
    enriquecido: !!d,
    atualizado_em: new Date().toISOString(),
  };
}
async function searchAndStore(f: Filtros) {
  const res = await cdSearch(cdBody(f));
  const items = res.items.map((x) => ({ x, c: digits(x.cnpj).padStart(14, "0") })).filter((o) => o.c.length === 14);
  if (!items.length) return { ...res, rows: [] as any[], novos: 0, proximo_ate: null as string | null };
  const { data: have } = await sb.from("empresas").select("*").in("cnpj", items.map((o) => o.c));
  const cache = new Map((have || []).map((r: any) => [r.cnpj, r]));
  const todo = items.filter((o) => !cache.get(o.c)?.enriquecido);
  const fresh: any[] = [];
  for (let i = 0; i < todo.length; i += 5) {
    const looked = await Promise.all(todo.slice(i, i + 5).map((o) => lookup(o.c)));
    looked.forEach((l, k) => fresh.push(rowFrom(todo[i + k].c, todo[i + k].x, l.data)));
  }
  if (fresh.length) {
    const { error } = await sb.from("empresas").upsert(fresh, { onConflict: "cnpj" });
    if (error) res.detail = "erro ao salvar: " + error.message;
  }
  const byC = new Map(fresh.map((r) => [r.cnpj, r]));
  const todas = items.map((o) => byC.get(o.c) || cache.get(o.c)).filter(Boolean);
  const rows = todas.filter((r: any) => !r.situacao || norm(r.situacao) === "ativa");
  // a fonte devolve no máximo 20 por vez, das mais novas para as mais antigas: a próxima leva começa antes da mais antiga desta
  const datas = todas.map((r: any) => r.abertura).filter(isDate).sort();
  const proximo_ate = res.total > items.length && datas.length ? dayBefore(datas[0]) : null;
  return { ...res, rows, novos: fresh.filter((r) => !cache.has(r.cnpj)).length, proximo_ate };
}
function safeLike(s: string) { return s.replace(/[%,()*]/g, " ").trim(); }
async function queryBase(f: Filtros, pagina = 1, porPagina = 50, ordem = "recentes") {
  porPagina = Math.max(1, Math.min(porPagina, 200));
  let q = sb.from("empresas").select("*", { count: "exact" });
  if (f.uf.length) q = q.in("uf", f.uf);
  if (f.municipio.length) q = q.in("municipio_norm", f.municipio.map(norm));
  if (f.preset) q = PRESETS[f.preset].base!(q);
  else {
    if (f.cnae.length) q = q.in("cnae", f.cnae);
    if (f.mei === "sim") q = q.eq("mei", true); else if (f.mei === "nao") q = q.eq("mei", false);
  }
  if (f.abertura_de) q = q.gte("abertura", f.abertura_de);
  if (f.abertura_ate) q = q.lte("abertura", f.abertura_ate);
  if (f.somente_celular) q = q.eq("celular", true); else if (f.com_telefone) q = q.not("tel1", "is", null);
  if (f.com_email) q = q.not("email", "is", null);
  if (f.texto) { const t = safeLike(f.texto); if (t) q = q.or(`razao.ilike.*${t}*,fantasia.ilike.*${t}*,cnae_desc.ilike.*${t}*,cnpj.like.*${digits(t) || "x"}*`); }
  const ord: Record<string, [string, boolean][]> = {
    recentes: [["criado_em", false]], abertura: [["abertura", false]], antigas: [["abertura", true]],
    nome: [["razao", true]], cidade: [["uf", true], ["municipio_norm", true]], capital: [["capital", false]],
  };
  for (const [col, asc] of ord[ordem] || ord.recentes) q = q.order(col, { ascending: asc, nullsFirst: false });
  const from = (Math.max(1, pagina) - 1) * porPagina;
  const { data, count, error } = await q.range(from, from + porPagina - 1);
  if (error) throw new Error(error.message);
  return { rows: data || [], total: count || 0 };
}
async function stats() {
  const c = async (fn: (q: any) => any) => { const { count } = await fn(sb.from("empresas").select("cnpj", { count: "exact", head: true })); return count || 0; };
  const [total, comTel, cel] = await Promise.all([c((q) => q), c((q) => q.not("tel1", "is", null)), c((q) => q.eq("celular", true))]);
  return { total, com_telefone: comTel, celular: cel };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: u } = await sb.auth.getUser(token);
  if (!u?.user) return json({ error: "Faça login novamente." }, 401);
  const { data: cons } = await sb.from("app_consultoras").select("ativo").eq("user_id", u.user.id).maybeSingle();
  if (!cons?.ativo) return json({ error: "Acesso não liberado para este usuário." }, 403);

  let p: Record<string, any>;
  try { p = await req.json(); } catch { return json({ error: "JSON inválido" }, 400); }
  const f = cleanFiltros(p.filtros || {});
  try {
    switch (p.action) {
      case "ping": return json({ ok: true });
      case "search": {
        if (!f.cnae.length && !f.texto && !f.uf.length) return json({ error: "Escolha ao menos um segmento, um estado ou um texto." }, 400);
        const r = await searchAndStore(f);
        await sb.from("varredura_log").insert({ uf: f.uf.join(",") || null, municipio: f.municipio.join(",") || null, status: r.status, encontrados: r.items.length, novos: r.novos, detalhe: (r.detail || "") + " [app" + (f.preset ? ":" + f.preset : "") + "]", filtros: f });
        if (r.status !== 200) return json({ error: "A fonte da Receita não respondeu (" + r.status + "). Tente de novo em instantes." }, 502);
        return json({ rows: r.rows, total_fonte: r.total, novos: r.novos, proximo_ate: r.proximo_ate });
      }
      case "base": return json(await queryBase(f, Number(p.pagina) || 1, Number(p.por_pagina) || 50, String(p.ordem || "recentes")));
      case "stats": return json(await stats());
      case "cnpj": {
        const c = digits(p.cnpj).padStart(14, "0");
        if (c.length !== 14) return json({ error: "CNPJ inválido" }, 400);
        const l = await lookup(c);
        if (!l.data) return json({ error: l.status === 404 ? "CNPJ não encontrado nas bases públicas" : "Fonte indisponível" }, l.status === 404 ? 404 : 502);
        const row = rowFrom(c, {}, l.data);
        await sb.from("empresas").upsert(row, { onConflict: "cnpj" });
        return json({ row });
      }
      default: return json({ error: "Ação inválida" }, 400);
    }
  } catch (e) {
    return json({ error: "Erro interno", detail: String(e).slice(0, 300) }, 500);
  }
});
