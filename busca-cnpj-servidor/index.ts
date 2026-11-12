// Função "busca-cnpj" — backend da Busca de Empresas (uso interno).
// Todas as chamadas: POST JSON com o cabeçalho "x-acesso: <senha>" (segredo ACCESS_KEY).
//   { action: "search", filtros }          → pesquisa na Receita (Casa dos Dados), busca contatos, salva e devolve
//   { action: "base", filtros, pagina, por_pagina, ordem } → consulta a base própria (tudo o que já foi salvo)
//   { action: "stats" }                    → números da base
//   { action: "cnpj", cnpj }               → ficha completa de um CNPJ (salva na base)
//   { action: "sweep", filtros, tasks: [{ uf, municipio }] } → varredura por cidades (até 4 por chamada)
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-acesso",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const CASA_DOS_DADOS = "https://api.casadosdados.com.br/v5/public/cnpj/pesquisa";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const norm = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const digits = (s: unknown) => String(s ?? "").replace(/\D/g, "");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isoDaysAgo = (d: number) => new Date(Date.now() - d * 864e5).toISOString().slice(0, 10);
const isDate = (s: unknown) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const strList = (v: unknown, re?: RegExp) =>
  (Array.isArray(v) ? v : v ? [v] : []).map((x) => String(x).trim()).filter((x) => x && (!re || re.test(x))).slice(0, 30);

type Filtros = {
  uf?: string[]; municipio?: string[]; cnae?: string[]; secundaria?: boolean;
  mei?: "sim" | "nao" | ""; simples?: "sim" | "nao" | "";
  abertura_de?: string; abertura_ate?: string; capital_min?: number; capital_max?: number;
  com_telefone?: boolean; somente_celular?: boolean; com_email?: boolean; somente_matriz?: boolean;
  texto?: string; com_contato?: boolean; porte?: string[];
};

function cleanFiltros(f: Record<string, unknown> = {}): Filtros {
  return {
    uf: strList(f.uf, /^[A-Za-z]{2}$/).map((u) => u.toUpperCase()),
    municipio: strList(f.municipio),
    cnae: strList(f.cnae, /^\d{7}$/),
    secundaria: !!f.secundaria,
    mei: f.mei === "sim" || f.mei === "nao" ? f.mei : "",
    simples: f.simples === "sim" || f.simples === "nao" ? f.simples : "",
    abertura_de: isDate(f.abertura_de) ? String(f.abertura_de) : undefined,
    abertura_ate: isDate(f.abertura_ate) ? String(f.abertura_ate) : undefined,
    capital_min: Number(f.capital_min) > 0 ? Number(f.capital_min) : undefined,
    capital_max: Number(f.capital_max) > 0 ? Number(f.capital_max) : undefined,
    com_telefone: !!f.com_telefone, somente_celular: !!f.somente_celular, com_email: !!f.com_email,
    somente_matriz: !!f.somente_matriz,
    texto: typeof f.texto === "string" ? f.texto.trim().slice(0, 80) : "",
    com_contato: f.com_contato !== false,
    porte: strList(f.porte),
  };
}

// ---------- Casa dos Dados ----------
function cdBody(f: Filtros, loc?: { uf?: string; municipio?: string }) {
  const b: Record<string, unknown> = { situacao_cadastral: ["ATIVA"], limite: 20, pagina: 1 };
  if (f.cnae?.length) { b.codigo_atividade_principal = f.cnae; if (f.secundaria) b.incluir_atividade_secundaria = true; }
  const ufs = loc?.uf ? [loc.uf] : f.uf || [];
  const muns = loc?.municipio ? [loc.municipio] : f.municipio || [];
  if (ufs.length) b.uf = ufs.map((u) => u.toLowerCase());
  if (muns.length) b.municipio = muns.map(norm);
  if (f.mei === "sim") b.mei = { optante: true }; else if (f.mei === "nao") b.mei = { excluir_optante: true };
  if (f.simples === "sim") b.simples = { optante: true }; else if (f.simples === "nao") b.simples = { excluir_optante: true };
  let ate = f.abertura_ate;
  // Cadastros abertos há menos de 2 meses ainda não têm contato nas bases públicas
  if (f.com_contato) { const lim = isoDaysAgo(60); if (!ate || ate > lim) ate = lim; }
  if (f.abertura_de || ate) b.data_abertura = { inicio: f.abertura_de || "1900-01-01", fim: ate || isoDaysAgo(0) };
  if (f.capital_min || f.capital_max) b.capital_social = { minimo: f.capital_min || 0, maximo: f.capital_max || 1e12 };
  const mf: Record<string, boolean> = {};
  if (f.com_telefone) mf.com_telefone = true;
  if (f.somente_celular) mf.somente_celular = true;
  if (f.com_email) mf.com_email = true;
  if (f.somente_matriz) mf.somente_matriz = true;
  if (Object.keys(mf).length) b.mais_filtros = mf;
  if (f.texto) b.busca_textual = [{ texto: [f.texto], tipo_busca: "exata", razao_social: true, nome_fantasia: true, nome_socio: false }];
  return b;
}

async function fetchT(url: string, init: RequestInit = {}, ms = 15000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
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
    } catch (e) { if (i < 2) { await sleep(1500); continue; } return { status: 504, items: [], total: 0, detail: String(e) }; }
    const text = await r.text();
    if (r.status === 429 || r.status >= 500) { await sleep(2000 * (i + 1)); continue; }
    if (!r.ok) return { status: r.status, items: [], total: 0, detail: text.slice(0, 300) };
    const d = JSON.parse(text);
    const items = d.cnpjs || d.empresas || d.data?.cnpj || (Array.isArray(d.data) ? d.data : []) || [];
    return { status: 200, items: items as Record<string, any>[], total: Number(d.total) || items.length, detail: "" };
  }
  return { status: 429, items: [], total: 0, detail: "limite de requisições da fonte" };
}

// ---------- Contatos (BrasilAPI / Minha Receita) ----------
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
  const e = x.endereco || {};
  const g = d || {};
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

// Pesquisa + contatos + salvar. Devolve as linhas completas.
async function searchAndStore(f: Filtros, loc?: { uf?: string; municipio?: string }) {
  const res = await cdSearch(cdBody(f, loc));
  const items = res.items.map((x) => ({ x, c: digits(x.cnpj).padStart(14, "0") })).filter((o) => o.c.length === 14);
  if (!items.length) return { ...res, rows: [] as any[], novos: 0 };
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
  const rows = items.map((o) => byC.get(o.c) || cache.get(o.c)).filter(Boolean)
    .filter((r: any) => !r.situacao || norm(r.situacao) === "ativa");
  const novos = fresh.filter((r) => !cache.has(r.cnpj)).length;
  return { ...res, rows, novos };
}

// ---------- Base própria ----------
function safeLike(s: string) { return s.replace(/[%,()*]/g, " ").trim(); }
async function queryBase(f: Filtros, pagina = 1, porPagina = 50, ordem = "recentes") {
  porPagina = Math.max(1, Math.min(porPagina, 500));
  let q = sb.from("empresas").select("*", { count: "exact" });
  if (f.uf?.length) q = q.in("uf", f.uf);
  if (f.municipio?.length) q = q.in("municipio_norm", f.municipio.map(norm));
  if (f.cnae?.length) q = q.in("cnae", f.cnae);
  if (f.mei === "sim") q = q.eq("mei", true); else if (f.mei === "nao") q = q.eq("mei", false);
  if (f.simples === "sim") q = q.eq("simples", true); else if (f.simples === "nao") q = q.eq("simples", false);
  if (f.abertura_de) q = q.gte("abertura", f.abertura_de);
  if (f.abertura_ate) q = q.lte("abertura", f.abertura_ate);
  if (f.capital_min) q = q.gte("capital", f.capital_min);
  if (f.capital_max) q = q.lte("capital", f.capital_max);
  if (f.somente_celular) q = q.eq("celular", true);
  else if (f.com_telefone) q = q.not("tel1", "is", null);
  if (f.com_email) q = q.not("email", "is", null);
  if (f.somente_matriz) q = q.eq("matriz", true);
  if (f.porte?.length) q = q.in("porte", f.porte);
  if (f.texto) { const t = safeLike(f.texto); if (t) q = q.or(`razao.ilike.*${t}*,fantasia.ilike.*${t}*,cnpj.like.*${digits(t) || "x"}*`); }
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
  const [total, comTel, cel, email] = await Promise.all([
    c((q) => q), c((q) => q.not("tel1", "is", null)), c((q) => q.eq("celular", true)), c((q) => q.not("email", "is", null)),
  ]);
  const { data: porUf } = await sb.from("empresas_por_uf").select("*").order("total", { ascending: false });
  const { data: ult } = await sb.from("varredura_log").select("uf,municipio,encontrados,novos,criado_em,filtros").order("id", { ascending: false }).limit(8);
  return { total, com_telefone: comTel, celular: cel, email, por_uf: porUf || [], ultimas: ult || [] };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);
  const key = Deno.env.get("ACCESS_KEY");
  const hdr = req.headers.get("x-acesso") || "";
  let ok = !!key && hdr === key;
  if (!ok && hdr.length >= 32) {
    // chave interna temporária (carga inicial feita pelo próprio banco)
    const { data } = await sb.from("config_interna").select("valor").eq("chave", "chave_servidor").maybeSingle();
    ok = !!data && data.valor === hdr;
  }
  if (!ok) {
    if (!key) return json({ error: "A senha de acesso ainda não foi configurada no Supabase (segredo ACCESS_KEY)." }, 503);
    await sleep(600);
    return json({ error: "Senha incorreta" }, 401);
  }

  let p: Record<string, any>;
  try { p = await req.json(); } catch { return json({ error: "JSON inválido" }, 400); }
  const f = cleanFiltros(p.filtros || {});

  try {
    switch (p.action) {
      case "ping": return json({ ok: true });
      case "search": {
        if (!f.cnae?.length && !f.texto && !f.uf?.length) return json({ error: "Escolha ao menos uma atividade, um estado ou um texto." }, 400);
        const r = await searchAndStore(f);
        await sb.from("varredura_log").insert({ uf: f.uf?.join(",") || null, municipio: f.municipio?.join(",") || null, status: r.status, encontrados: r.items.length, novos: r.novos, detalhe: r.detail || null, filtros: f });
        if (r.status !== 200) return json({ error: "A fonte da Receita não respondeu (" + r.status + "). Tente de novo em instantes.", detail: r.detail }, 502);
        return json({ rows: r.rows, total_fonte: r.total, novos: r.novos });
      }
      case "base": {
        const r = await queryBase(f, Number(p.pagina) || 1, Number(p.por_pagina) || 50, String(p.ordem || "recentes"));
        return json(r);
      }
      case "stats": return json(await stats());
      case "cnpj": {
        const c = digits(p.cnpj).padStart(14, "0");
        if (c.length !== 14) return json({ error: "CNPJ inválido" }, 400);
        const l = await lookup(c);
        if (!l.data) return json({ error: l.status === 404 ? "CNPJ não encontrado nas bases públicas" : "Fonte indisponível" }, l.status === 404 ? 404 : 502);
        const row = rowFrom(c, {}, l.data);
        await sb.from("empresas").upsert(row, { onConflict: "cnpj" });
        return json({ row, socios: (l.data.qsa || []).map((s: any) => ({ nome: s.nome_socio, qualificacao: s.qualificacao_socio })), secundarias: l.data.cnaes_secundarios || [] });
      }
      case "sweep": {
        const tasks = (Array.isArray(p.tasks) ? p.tasks : []).filter((t: any) => t && /^[A-Za-z]{2}$/.test(t.uf)).slice(0, 4);
        const out = [];
        const t0 = Date.now();
        for (const t of tasks) {
          if (Date.now() - t0 > 100000) { out.push({ ...t, status: 0, pulado: true }); continue; }
          const loc = { uf: String(t.uf).toUpperCase(), municipio: t.municipio ? String(t.municipio) : undefined };
          const r = await searchAndStore(f, loc);
          await sb.from("varredura_log").insert({ uf: loc.uf, municipio: loc.municipio || null, status: r.status, encontrados: r.items.length, novos: r.novos, detalhe: r.detail || null, filtros: f });
          out.push({ ...loc, status: r.status, encontrados: r.items.length, novos: r.novos });
        }
        return json({ results: out });
      }
      default: return json({ error: "Ação inválida" }, 400);
    }
  } catch (e) {
    return json({ error: "Erro interno", detail: String(e).slice(0, 300) }, 500);
  }
});
