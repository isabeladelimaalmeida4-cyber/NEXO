/* NEXO — vídeo vertical (1080×1920, 25 s) desenhado em canvas.
   Tipografia do brand book: Playfair Display (títulos) e Work Sans (corpo/rótulos).
   Movimentos seguem o vídeo de referência: palavras em cascata, saídas com desfoque
   de movimento, ícone que abre um mural em perspectiva, ondas de choque, cartões que
   viram botões, troca de palavra em rolagem, giro 3D do símbolo e fecho com brilho. */
(() => {
  'use strict';

  const W = 1080, H = 1920, DUR = 25;
  const C = {
    vinho: '#1F090B', vinhoN: '#2B1014', vinhoM: '#3A181D',
    champ: '#C6A16A', marfim: '#F4EEE8', cinza: '#D5C9C7',
  };
  const SERIF = '"Playfair Display", Georgia, serif';
  const SANS = '"Work Sans", system-ui, sans-serif';
  const F = (peso, tam, fam, ital) => `${ital ? 'italic ' : ''}${peso} ${tam}px ${fam}`;

  const canvas = document.getElementById('video');
  const ctx = canvas.getContext('2d');

  /* ---------- utilidades ---------- */
  const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, k) => a + (b - a) * k;
  const P = (t, a, b) => clamp((t - a) / (b - a));
  const ease = {
    out: k => 1 - (1 - k) ** 3,
    in: k => k * k * k,
    inOut: k => (k < .5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2),
    back: k => { const c1 = 1.6, c3 = c1 + 1; return 1 + c3 * (k - 1) ** 3 + c1 * (k - 1) ** 2; },
    spring: k => (k >= 1 ? 1 : 1 - Math.exp(-7 * k) * Math.cos(k * 13)),
    expo: k => (k >= 1 ? 1 : 1 - 2 ** (-10 * k)),
  };
  const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const mix = (a, b, k) => { const A = rgb(a), B = rgb(b); return `rgb(${A.map((v, i) => Math.round(lerp(v, B[i], k))).join(',')})`; };
  const rgba = (h, a) => `rgba(${rgb(h).join(',')},${a})`;

  const novaTela = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };
  const medidor = document.createElement('canvas').getContext('2d');
  const largura = it => {
    if (it.w != null) return it.w;
    medidor.font = it.font;
    medidor.letterSpacing = (it.ls || 0) + 'px';
    return medidor.measureText(it.text).width;
  };

  /* Camada: desenha em tela auxiliar e aplica desfoque, rastro de movimento e opacidade. */
  const pilha = [];
  let nivel = 0;
  function camada(g, o, desenhar) {
    const alpha = o.alpha ?? 1, blur = o.blur || 0, mx = o.mx || 0, my = o.my || 0;
    if (alpha <= .003) return;
    const rastro = Math.hypot(mx, my);
    if (blur < .3 && rastro < 1) {
      g.save(); g.globalAlpha *= alpha; desenhar(g); g.restore();
      return;
    }
    if (!pilha[nivel]) pilha[nivel] = [novaTela(), novaTela()];
    const [ta, tb] = pilha[nivel++];
    const a = ta.getContext('2d');
    a.setTransform(1, 0, 0, 1, 0, 0); a.clearRect(0, 0, W, H);
    a.setTransform(g.getTransform());
    a.globalAlpha = 1; a.filter = 'none';
    desenhar(a);
    let fonte = ta;
    if (rastro >= 1) {
      const b = tb.getContext('2d');
      b.setTransform(1, 0, 0, 1, 0, 0); b.clearRect(0, 0, W, H);
      const n = Math.min(18, Math.max(5, Math.ceil(rastro / 7)));
      b.globalCompositeOperation = 'lighter'; b.globalAlpha = 1 / n;
      for (let i = 0; i < n; i++) { const k = i / (n - 1) - .5; b.drawImage(ta, mx * k, my * k); }
      b.globalCompositeOperation = 'source-over'; b.globalAlpha = 1;
      fonte = tb;
    }
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha *= alpha;
    if (blur >= .3) g.filter = `blur(${blur}px)`;
    g.drawImage(fonte, 0, 0);
    g.restore();
    nivel--;
  }

  const em = (g, x, y, s, rot, fn) => {
    g.save(); g.translate(x, y); if (rot) g.rotate(rot);
    if (Array.isArray(s)) g.scale(s[0], s[1]); else if (s !== 1) g.scale(s, s);
    g.translate(-x, -y); fn(g); g.restore();
  };

  /* ---------- frases palavra a palavra ---------- */
  function medir(t, itens, o) {
    const gap = o.gap ?? 22, dur = o.dur ?? .45;
    let total = 0;
    const linhas = itens.map((it, i) => {
      const k = P(t, it.t0, it.t0 + (it.dur ?? dur));
      const w = largura(it);
      const l = o.cresce === false ? 1 : ease.out(clamp(k * 1.7));
      const g = i ? gap : 0;
      total += (w + g) * l;
      return { it, k, w, l, g };
    });
    return { linhas, total };
  }

  function frase(g, t, itens, o) {
    const { linhas, total } = medir(t, itens, o);
    let x = o.align === 'left' ? o.x : o.x - total / 2;
    for (const r of linhas) {
      x += r.g * r.l;
      const cx = x + r.w / 2;
      x += r.w * r.l;
      if (r.k <= 0) continue;
      const it = r.it;
      const f = Object.assign({ dx: 0, dy: 60, s: .7, blur: 10, rot: 0 }, o.de, it.de);
      const e = (it.ease || o.ease || ease.back)(r.k);
      const alpha = ease.out(clamp(r.k * 1.8)) * (it.alpha ?? 1);
      if (alpha <= .003) continue;
      g.save();
      g.globalAlpha *= alpha;
      g.translate(cx + f.dx * (1 - e), o.y + (it.y || 0) + f.dy * (1 - e));
      if (f.rot) g.rotate(f.rot * (1 - e));
      const s = lerp(f.s, 1, e);
      g.scale(s, s);
      const bl = f.blur * (1 - ease.out(r.k));
      if (bl > .3) g.filter = `blur(${bl}px)`;
      if (it.draw) it.draw(g, r.k, e);
      else {
        g.font = it.font;
        g.letterSpacing = (it.ls || 0) + 'px';
        g.fillStyle = typeof it.color === 'function' ? it.color(t) : it.color;
        g.textAlign = 'center'; g.textBaseline = 'alphabetic';
        g.fillText(it.text, (it.ls || 0) / 2, 0);
      }
      g.restore();
    }
    return total;
  }

  const texto = (g, s, x, y, font, color, align = 'center', ls = 0) => {
    g.font = font; g.fillStyle = color; g.textAlign = align; g.textBaseline = 'alphabetic';
    g.letterSpacing = ls + 'px';
    g.fillText(s, x + (align === 'center' ? ls / 2 : 0), y);
    g.letterSpacing = '0px';
  };

  /* ---------- marca e ícones ---------- */
  // Símbolo "N": hastes marfim, diagonal champagne e dois pontos (geometria do SVG oficial).
  function simbolo(g, cx, cy, tam, k = 1, cores = {}) {
    const s = tam / 120, haste = cores.haste || C.marfim, acento = cores.acento || C.champ;
    g.save();
    g.translate(cx, cy); g.scale(s, s); g.translate(-60, -60);
    g.lineCap = 'round'; g.lineWidth = 6;
    const traco = (x1, y1, x2, y2, p, cor) => {
      if (p <= 0) return;
      g.strokeStyle = cor; g.beginPath(); g.moveTo(x1, y1); g.lineTo(lerp(x1, x2, p), lerp(y1, y2, p)); g.stroke();
    };
    traco(30, 24, 90, 96, ease.inOut(P(k, .22, .62)), acento);
    traco(30, 96, 30, 24, ease.inOut(P(k, 0, .36)), haste);
    traco(90, 96, 90, 24, ease.inOut(P(k, .45, .82)), haste);
    g.fillStyle = acento;
    const r1 = 9 * ease.back(P(k, .6, .86)), r2 = 9 * ease.back(P(k, .72, .98));
    if (r1 > 0) { g.beginPath(); g.arc(30, 96, r1, 0, Math.PI * 2); g.fill(); }
    if (r2 > 0) { g.beginPath(); g.arc(90, 24, r2, 0, Math.PI * 2); g.fill(); }
    g.restore();
  }

  const ICONES = {
    site: new Path2D('M5 4.5h14a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2zM3 9h18M6.5 6.8h.01M9 6.8h.01'),
    automacao: new Path2D('M20 12a8 8 0 0 1-14.3 4.9M4 12a8 8 0 0 1 14.3-4.9M18.5 3.5v3.6h-3.6M5.5 20.5v-3.6h3.6'),
    aviso: new Path2D('M12 4 2.5 20h19L12 4zM12 10v4.5M12 17.3h.01'),
    planilha: new Path2D('M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM14 3v5h5M8.5 12.5h7M8.5 16h7M12 11v8'),
    seta: new Path2D('M5 12h14M13 6l6 6-6 6'),
  };
  function icone(g, nome, cx, cy, tam, cor, lw = 1.7) {
    g.save();
    g.translate(cx - tam / 2, cy - tam / 2); g.scale(tam / 24, tam / 24);
    g.strokeStyle = cor; g.lineWidth = lw; g.lineCap = 'round'; g.lineJoin = 'round';
    g.stroke(ICONES[nome]);
    g.restore();
  }

  function caixa(g, x, y, w, h, r, fill, stroke, sombra = true) {
    g.save();
    if (sombra) { g.shadowColor = 'rgba(8,1,2,.55)'; g.shadowBlur = 70; g.shadowOffsetY = 24; }
    g.beginPath(); g.roundRect(x - w / 2, y - h / 2, w, h, Math.min(r, h / 2, w / 2));
    g.fillStyle = fill; g.fill();
    g.restore();
    if (stroke) {
      g.save(); g.beginPath(); g.roundRect(x - w / 2, y - h / 2, w, h, Math.min(r, h / 2, w / 2));
      g.strokeStyle = stroke; g.lineWidth = 2.5; g.stroke(); g.restore();
    }
  }

  // Tile "de app" com o símbolo, que abre o mural de sites.
  function tileSimbolo(g, x, y, tam, brilho = 1) {
    caixa(g, x, y, tam, tam, tam * .26, C.vinhoM, rgba(C.champ, .55));
    g.save(); g.globalAlpha *= brilho;
    simbolo(g, x, y + tam * .02, tam * .62);
    g.restore();
  }

  /* ---------- mural de sites em perspectiva ---------- */
  const FOTOS = [
    '../assets/projetos/orbita.jpg', '../assets/exemplos/sis-agenda.webp', '../assets/projetos/torno.jpg',
    '../assets/exemplos/auto-dados.webp', '../assets/projetos/parcelas.jpg', '../assets/exemplos/sis-loja.webp',
    '../assets/exemplos/agente.webp', '../assets/exemplos/auto-criacao.webp', '../assets/exemplos/auto-preench.webp',
  ].map(src => { const i = new Image(); i.src = src; return i; });

  function mural(g, cam) {
    const { rx = 0, ry = 0, rz = 0, z = 2000, cx = W / 2, cy = H / 2, ox = 0, oy = 0, f = 1500 } = cam;
    const TW = 640, TH = 400, GAP = 46, COLS = 7, ROWS = 9;
    const cX = Math.cos(rx), sX = Math.sin(rx), cY = Math.cos(ry), sY = Math.sin(ry), cZ = Math.cos(rz), sZ = Math.sin(rz);
    const proj = (x, y) => {
      const x1 = x * cZ - y * sZ, y1 = x * sZ + y * cZ;
      const y2 = y1 * cX, z2 = y1 * sX;
      const x3 = x1 * cY + z2 * sY, z3 = -x1 * sY + z2 * cY + z;
      return z3 < 80 ? null : [cx + f * x3 / z3, cy + f * y2 / z3, z3];
    };
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const x0 = (c - (COLS - 1) / 2) * (TW + GAP) - TW / 2 + ox;
        const y0 = (r - (ROWS - 1) / 2) * (TH + GAP) - TH / 2 + oy;
        const p0 = proj(x0, y0), p1 = proj(x0 + TW, y0), p2 = proj(x0, y0 + TH), p3 = proj(x0 + TW, y0 + TH);
        if (!p0 || !p1 || !p2 || !p3) continue;
        const xs = [p0[0], p1[0], p2[0], p3[0]], ys = [p0[1], p1[1], p2[1], p3[1]];
        if (Math.max(...xs) < -300 || Math.min(...xs) > W + 300 || Math.max(...ys) < -300 || Math.min(...ys) > H + 300) continue;
        const img = FOTOS[(r * 4 + c * 3) % FOTOS.length];
        g.save();
        g.transform((p1[0] - p0[0]) / TW, (p1[1] - p0[1]) / TW, (p2[0] - p0[0]) / TH, (p2[1] - p0[1]) / TH, p0[0], p0[1]);
        g.beginPath(); g.roundRect(0, 0, TW, TH, 24); g.clip();
        if (img.complete && img.naturalWidth) g.drawImage(img, 0, 0, TW, TH);
        else { g.fillStyle = C.vinhoM; g.fillRect(0, 0, TW, TH); }
        const fundoZ = clamp((p0[2] - 1300) / 5000, 0, .7);
        g.fillStyle = rgba(C.vinho, .12 + fundoZ);
        g.fillRect(0, 0, TW, TH);
        g.strokeStyle = rgba(C.champ, .35); g.lineWidth = 5; g.stroke();
        g.restore();
      }
    }
  }

  let listras = null;
  const padraoListras = g => {
    if (listras) return listras;
    const c = document.createElement('canvas'); c.width = 4; c.height = 7;
    const x = c.getContext('2d'); x.fillStyle = 'rgba(10,2,3,.42)'; x.fillRect(0, 0, 4, 2);
    return (listras = g.createPattern(c, 'repeat'));
  };

  /* ---------- fundo vinho com manchas em movimento ---------- */
  function fundo(g, t) {
    g.fillStyle = C.vinho; g.fillRect(0, 0, W, H);
    const manchas = [
      [C.vinhoM, .95, 820, 540 + 360 * Math.sin(t * .33), 520 + 300 * Math.cos(t * .27)],
      [C.vinhoN, .9, 760, 300 + 260 * Math.cos(t * .41 + 1), 1300 + 280 * Math.sin(t * .3 + 2)],
      [C.vinhoM, .75, 640, 860 + 200 * Math.sin(t * .37 + 3), 1500 + 260 * Math.cos(t * .23)],
      [C.champ, .09, 700, 760 + 260 * Math.sin(t * .29 + 4), 820 + 360 * Math.cos(t * .35 + 1)],
    ];
    for (const [cor, a, r, x, y] of manchas) {
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, rgba(cor, a)); gr.addColorStop(1, rgba(cor, 0));
      g.fillStyle = gr; g.fillRect(0, 0, W, H);
    }
    const v = g.createRadialGradient(W / 2, H / 2, 520, W / 2, H / 2, 1250);
    v.addColorStop(0, 'rgba(12,3,4,0)'); v.addColorStop(1, 'rgba(12,3,4,.6)');
    g.fillStyle = v; g.fillRect(0, 0, W, H);
  }

  function camera(g, t) {
    const s = 1 + .012 * Math.sin(t * .7), r = .0035 * Math.sin(t * .9 + 1);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.translate(W / 2 + 7 * Math.sin(t * 1.1), H / 2 + 6 * Math.cos(t * .8));
    g.rotate(r); g.scale(s, s); g.translate(-W / 2, -H / 2);
  }

  /* ---------- cenas ---------- */
  const CY = 960;

  // trajetória do tile entre as cenas 2 e 3
  function posTile(t) {
    if (t < 1.3) return { x: 540, y: CY, s: ease.spring(P(t, 1.05, 1.5)) };
    if (t < 2.0) { const e = ease.inOut(P(t, 1.3, 2.0)); return { x: 540, y: lerp(CY, 1330, e), s: lerp(1, 1.9, e) }; }
    if (t < 2.4) { const e = ease.inOut(P(t, 2.0, 2.4)); return { x: lerp(540, 330, e), y: lerp(1330, 1450, e), s: lerp(1.9, 2.3, e) }; }
    const e = ease.out(P(t, 2.4, 2.62));
    return { x: lerp(330, 540, e), y: lerp(1450, CY, e), s: lerp(2.3, 1.75, e) };
  }

  const CENAS = [
    // 1 · "Deixa eu adivinhar…" em cascata, sai para a direita com rastro
    { a: 0, b: 1.3, draw(g, t) {
      const cor = () => mix(C.champ, C.marfim, ease.inOut(P(t, .45, .85)));
      const itens = [['Deixa', .05], ['eu', .17], ['adivinhar…', .29]]
        .map(([text, t0]) => ({ text, t0, font: F(600, 92, SERIF), color: cor }));
      const k = ease.in(P(t, .95, 1.25));
      camada(g, { alpha: 1 - k, mx: 170 * k, blur: 4 * k }, x => em(x, 540, CY, lerp(.94, 1.04, P(t, 0, 1.2)), 0, x => {
        x.translate(280 * k, 0);
        frase(x, t, itens, { x: 540, y: CY + 30, gap: 24, dur: .5, de: { dx: -70, dy: 100, s: .55, blur: 10 } });
      }));
    } },

    // 2 · tile com o símbolo surge e abre um leque com o mural de sites
    { a: 1.05, b: 2.4, draw(g, t) {
      const p = posTile(t), base = 150;
      const kw = P(t, 1.3, 2.4), e = ease.inOut(kw);
      if (kw > 0) {
        const abre = lerp(.05, Math.PI * 1.35, e), dir = -Math.PI / 2 + .45 * e;
        g.save();
        g.beginPath(); g.moveTo(p.x, p.y); g.arc(p.x, p.y, 4200, dir - abre / 2, dir + abre / 2); g.closePath(); g.clip();
        g.fillStyle = C.vinho; g.fillRect(-300, -300, W + 600, H + 600);
        mural(g, { rx: lerp(-1.1, -.42, e), ry: lerp(.35, .12, e), rz: lerp(.5, .18, e), z: lerp(4600, 1750, e), cx: 540, cy: lerp(420, 820, e), ox: lerp(-200, 260, e) });
        g.restore();
      }
      camada(g, { blur: 8 * (1 - P(t, 1.05, 1.25)) }, x => tileSimbolo(x, p.x, p.y, base * p.s));
    } },

    // 3 · mural tingido, ondas de choque e palavras dentro do tile; termina num zoom forte
    { a: 2.4, b: 3.9, draw(g, t) {
      const e = P(t, 2.4, 3.9), kp = ease.in(P(t, 3.55, 3.9));
      camada(g, { alpha: 1 - ease.in(P(t, 3.66, 3.9)), blur: 26 * kp }, x => em(x, 540, CY, 1 + 2.6 * kp, 0, x => {
        mural(x, { rx: -.24, ry: .14, rz: -.1 + .05 * e, z: lerp(2200, 1550, ease.out(e)), ox: 260 * e, oy: -120 * e });
        x.fillStyle = 'rgba(31,9,11,.66)'; x.fillRect(-300, -300, W + 600, H + 600);
        x.fillStyle = padraoListras(x); x.fillRect(-300, -300, W + 600, H + 600);
        const p = posTile(t);
        for (let i = 0; i < 2; i++) {
          const k = P(t, 2.4 + i * .08, 2.88 + i * .08);
          if (k <= 0 || k >= 1) continue;
          x.save();
          x.strokeStyle = rgba(C.marfim, 1 - ease.in(k)); x.lineWidth = lerp(20, 5, k);
          x.beginPath(); x.arc(p.x, p.y, lerp(70, 1500, ease.out(k)), 0, Math.PI * 2); x.stroke();
          x.restore();
        }
        const palavras = [['seu', 2.68], ['negócio', 2.95], ['é', 3.18], ['melhor.', 3.33]];
        let atual = null;
        for (const w of palavras) if (t >= w[1]) atual = w;
        tileSimbolo(x, p.x, p.y, 150 * p.s, atual ? .28 : 1);
        if (atual) {
          const k = ease.back(P(t, atual[1], atual[1] + .22));
          const fim = atual[0] === 'melhor.';
          x.save();
          x.translate(p.x, p.y + 38); x.scale(lerp(.5, 1, k), lerp(.5, 1, k));
          x.shadowColor = 'rgba(0,0,0,.6)'; x.shadowBlur = 40;
          texto(x, atual[0], 0, 0, F(700, fim ? 128 : 112, SERIF, fim), fim ? C.champ : C.marfim);
          x.restore();
        }
      }));
    } },

    // 4 · "do que o seu site" cresce; "mostra hoje." entra e assume o centro
    { a: 3.75, b: 5.7, draw(g, t) {
      const A = ['do', 'que', 'o', 'seu', 'site'].map((text, i) => ({ text, t0: 3.85 + i * .075, font: F(500, 84, SERIF), color: C.marfim }));
      const kA = P(t, 4.72, 5.0);
      camada(g, { alpha: 1 - kA, blur: 10 * kA }, x => em(x, 540, CY, lerp(.5, 1, ease.out(P(t, 3.8, 4.45))), 0, x => {
        x.translate(-150 * ease.inOut(P(t, 4.45, 4.8)) - 60 * kA, 0);
        frase(x, t, A, { x: 540, y: CY, gap: 20, dur: .4, de: { dx: -30, dy: -50, s: .4, blur: 6 } });
      }));
      const B = [
        { text: 'mostra', t0: 4.6, font: F(600, 124, SERIF, true), color: C.champ },
        { text: 'hoje.', t0: 5.02, font: F(600, 124, SERIF, true), color: C.marfim },
      ];
      const kB = ease.in(P(t, 5.42, 5.68));
      camada(g, { alpha: 1 - kB, mx: 190 * kB }, x => em(x, 540, CY, [1 - .35 * kB, 1], 0, x => {
        x.translate(lerp(340, 0, ease.inOut(P(t, 4.72, 5.1))), lerp(30, 0, ease.inOut(P(t, 4.72, 5.1))));
        frase(x, t, B, { x: 540, y: CY + 40, gap: 26, dur: .42, de: { dx: 70, dy: 50, s: .6, blur: 12 } });
      }));
    } },

    // 5 · cartão de alerta com o texto entrando palavra a palavra
    { zoom: 1.45, a: 5.6, b: 6.85, draw(g, t) {
      const ke = ease.out(P(t, 5.6, 5.92)), y = CY + 8 * Math.sin(t * 3);
      const w = 720, h = 140, esq = 540 - w / 2;
      camada(g, { alpha: ke, blur: 16 * (1 - ke) }, x => em(x, 540, y, lerp(.85, 1, ease.back(P(t, 5.6, 5.95))), 0, x => {
        x.translate(150 * (1 - ke), 80 * (1 - ke));
        caixa(x, 540, y, w, h, 38, C.vinhoM, rgba(C.champ, .3));
        const ki = ease.back(P(t, 5.68, 5.9)) * (1 - P(t, 6.72, 6.84));
        if (ki > 0) {
          x.save(); x.translate(esq + 72, y); x.scale(ki, ki);
          x.fillStyle = rgba(C.champ, .16); x.beginPath(); x.arc(0, 0, 36, 0, Math.PI * 2); x.fill();
          icone(x, 'aviso', 0, -1, 38, C.champ, 1.9);
          x.restore();
        }
        const itens = ['Seu', 'site', 'está', 'desatualizado'].map((text, i) => ({
          text, t0: 5.78 + i * .11, font: F(500, 38, SANS), color: i === 3 ? C.champ : C.marfim,
          alpha: 1 - P(t, 6.6 + (3 - i) * .05, 6.72 + (3 - i) * .05),
        }));
        frase(x, t, itens, { x: esq + 130, y: y + 13, gap: 12, align: 'left', dur: .32, de: { dx: 24, dy: 22, s: .6, blur: 6 } });
      }));
    } },

    // 6 · o cartão se transforma em arquivo de planilha com barra travando; depois vira pílula
    { zoom: 1.45, a: 6.85, b: 8.32, draw(g, t) {
      const km = ease.inOut(P(t, 6.85, 7.05)), kx = ease.inOut(P(t, 8.08, 8.32));
      const y = CY + 8 * Math.sin(t * 3);
      const w = lerp(lerp(720, 790, km), 480, kx), h = lerp(lerp(140, 214, km), 124, kx);
      const esq = 540 - w / 2;
      camada(g, { blur: 22 * Math.sin(Math.PI * kx) }, x => {
        caixa(x, 540, y, w, h, lerp(38, 62, kx), mix(C.vinhoM, C.champ, kx), rgba(C.champ, .3 * (1 - kx)));
        const conteudo = 1 - P(t, 8.02, 8.14);
        if (conteudo <= 0) return;
        x.save(); x.globalAlpha *= conteudo;
        const ki = ease.back(P(t, 6.95, 7.2));
        if (ki > 0) {
          x.save(); x.translate(esq + 82, y - 18); x.scale(ki, ki);
          x.beginPath(); x.roundRect(-40, -40, 80, 80, 20); x.fillStyle = rgba(C.champ, .16); x.fill();
          icone(x, 'planilha', 0, 0, 44, C.champ, 1.7);
          x.restore();
        }
        const nome = 'Planilha_final_v7.xlsx';
        const n = Math.round(nome.length * P(t, 6.98, 7.38));
        texto(x, nome.slice(0, n), esq + 148, y - 22, F(600, 34, SANS), C.marfim, 'left');
        x.globalAlpha *= P(t, 7.2, 7.45);
        texto(x, 'Atualizada à mão · 3h por semana', esq + 148 + 20 * (1 - P(t, 7.2, 7.45)), y + 22, F(400, 26, SANS), C.cinza, 'left');
        const bx = esq + 40, bw = w - 80, by = y + 64;
        x.beginPath(); x.roundRect(bx, by, bw, 9, 5); x.fillStyle = rgba(C.marfim, .12); x.fill();
        const frac = .62 * ease.out(P(t, 7.15, 8.0));
        if (frac > 0) { x.beginPath(); x.roundRect(bx, by, bw * frac, 9, 5); x.fillStyle = C.champ; x.fill(); }
        x.restore();
      });
    } },

    // 7 · pílula CTA "Quero meu site", balança, é "clicada" e sobe
    { zoom: 1.45, a: 8.32, b: 9.42, draw(g, t) {
      const itens = [
        { text: 'Quero', t0: 8.38, font: F(600, 42, SANS), color: C.vinho },
        { text: 'meu site', t0: 8.55, font: F(600, 42, SANS), color: C.vinho, de: { dx: 40, dy: 34, s: .5 } },
      ];
      const { total } = medir(t, itens, { gap: 12, dur: .35 });
      const balanco = 46 * Math.sin((t - 8.6) * 7) * P(t, 8.6, 8.75) * (1 - P(t, 8.95, 9.08));
      const ks = ease.in(P(t, 9.05, 9.36));
      const x0 = 540 + balanco, y0 = CY - 260 * ks;
      const aperta = 1 - .07 * Math.sin(Math.PI * P(t, 8.86, 9.02));
      camada(g, { alpha: 1 - P(t, 9.18, 9.42), my: -150 * ks, blur: 18 * (1 - ease.out(P(t, 8.32, 8.46))) }, x => em(x, x0, y0, aperta, 0, x => {
        caixa(x, x0, y0, Math.max(480, total + 120), 124, 62, C.champ);
        frase(x, t, itens, { x: x0, y: y0 + 15, gap: 12, dur: .35, de: { dy: 30, s: .6, blur: 6 } });
      }));
    } },

    // 8 · "Boas-vindas ao" + símbolo que se desenha
    { a: 9.36, b: 11.0, draw(g, t) {
      const itens = [
        { text: 'Boas-vindas', t0: 9.4, font: F(600, 84, SERIF), color: C.marfim },
        { text: 'ao', t0: 9.56, font: F(600, 84, SERIF), color: C.marfim },
        { w: 128, t0: 9.72, dur: .3, de: { s: .4, dy: 0, dx: 0 }, draw: x => simbolo(x, 0, -34, 150, P(t, 9.72, 10.4)) },
      ];
      const k = ease.in(P(t, 10.62, 10.98));
      camada(g, { alpha: 1 - k, blur: 6 * k }, x => em(x, 540, CY, (1 + .05 * P(t, 9.4, 10.6)) * lerp(1, .45, k), 0, x => {
        frase(x, t, itens, { x: 540, y: CY + 30, gap: 24, dur: .5, de: { dx: -90, dy: 80, s: .75, blur: 14 } });
      }));
    } },

    // 9 · cartão "Criação de sites"
    { zoom: 1.35, a: 10.98, b: 12.22, draw(g, t) {
      const ke = P(t, 10.98, 11.24), kx = P(t, 11.95, 12.22);
      camada(g, { alpha: ease.out(ke) * (1 - kx), blur: 18 * (1 - ease.out(ke)) + 14 * kx }, x => em(x, 540, CY, lerp(.8, 1, ease.back(ke)) * lerp(1, .94, kx), 0, x => {
        caixa(x, 540, CY, 620, 340, 42, C.vinhoM, rgba(C.champ, .3));
        const ki = ease.back(P(t, 11.08, 11.3));
        if (ki > 0) { x.save(); x.translate(540, CY - 92); x.scale(ki, ki); icone(x, 'site', 0, 0, 70, C.champ, 1.6); x.restore(); }
        const itens = ['Criação', 'de', 'sites'].map((text, i) => ({ text, t0: 11.18 + i * .09, font: F(600, 60, SERIF), color: C.marfim }));
        frase(x, t, itens, { x: 540, y: CY + 22, gap: 16, dur: .38, de: { dy: 30, s: .7, blur: 8 } });
        const ks = P(t, 11.48, 11.75);
        x.save(); x.globalAlpha *= ks;
        texto(x, 'Sob medida para o seu negócio', 540, CY + 92 + 16 * (1 - ease.out(ks)), F(400, 30, SANS), C.cinza);
        x.restore();
      }));
    } },

    // 10 · mancha desfocada vira pílula "Automatizar a rotina", que inclina e sai
    { zoom: 1.5, a: 12.18, b: 13.34, draw(g, t) {
      const kb = ease.out(P(t, 12.18, 12.42)), kx = ease.in(P(t, 12.98, 13.34));
      const itens = [
        { w: 50, t0: 12.28, draw: x => icone(x, 'automacao', 0, -14, 46, C.champ, 1.8) },
        { text: 'Automatizar', t0: 12.32, font: F(500, 42, SANS), color: C.marfim },
        { text: 'a rotina', t0: 12.52, font: F(500, 42, SANS), color: C.champ, de: { dx: 50, dy: -46, s: .45 } },
      ];
      const { total } = medir(t, itens, { gap: 16, dur: .38 });
      const w = lerp(240, total + 110, kb);
      camada(g, { alpha: 1 - kx, blur: 26 * (1 - kb) + 16 * kx, mx: -70 * kx, my: -90 * kx }, x => em(x, 540, CY, 1, -.26 * kx, x => {
        x.translate(-100 * kx, -150 * kx);
        caixa(x, 540, CY, w, 120, 60, C.vinhoM, rgba(C.champ, .8 * kb));
        frase(x, t, itens, { x: 540, y: CY + 15, gap: 16, dur: .38, de: { dy: 26, s: .6, blur: 6 } });
      }));
    } },

    // 11 · etiqueta inclinada "Planilhas e agenda em ordem!" que gira, cresce e desfoca
    { zoom: 1.5, a: 13.3, b: 14.64, draw(g, t) {
      const kr = ease.back(P(t, 13.3, 13.72)), kx = ease.in(P(t, 14.34, 14.64));
      const escalas = [1.5, .6, 1.4, .6, 1.3], alturas = [-34, 22, -22, 26, -16];
      const itens = ['Planilhas', 'e', 'agenda', 'em', 'ordem!'].map((text, i) => ({
        text, t0: 13.32 + i * .07, font: F(500, 40, SANS), color: i > 2 ? C.champ : C.marfim,
        de: { s: escalas[i], dy: alturas[i], blur: 8 },
      }));
      const { total } = medir(t, itens, { gap: 12, dur: .4 });
      const s = lerp(.7, 1, kr) * (1 + .1 * ease.inOut(P(t, 13.72, 14.34))) * (1 + .55 * kx);
      camada(g, { alpha: 1 - kx, blur: 22 * kx }, x => em(x, 540, CY, s, lerp(-.24, 0, kr), x => {
        x.save(); x.globalAlpha *= P(t, 13.36, 13.6);
        caixa(x, 540, CY, total + 90, 110, 55, C.vinhoN, rgba(C.champ, .35));
        x.restore();
        frase(x, t, itens, { x: 540, y: CY + 14, gap: 12, dur: .4 });
      }));
    } },

    // 12 · "Um site feito" + troca em rolagem "sob medida." → "com método."
    { a: 14.6, b: 17.3, draw(g, t) {
      const kx = P(t, 17.0, 17.28);
      const l1 = ['Um', 'site', 'feito'].map((text, i) => ({ text, t0: 14.65 + i * .12, font: F(600, 92, SERIF), color: C.marfim }));
      camada(g, { alpha: 1 - kx, blur: 12 * kx }, x => em(x, 540, CY, (1 + .05 * P(t, 14.6, 17)) * (1 - .05 * kx), 0, x => {
        frase(x, t, l1, { x: 540, y: CY - 40, gap: 24, dur: .5, de: { dx: 60, dy: 70, s: .7, blur: 12 } });
        const fonte = F(600, 108, SERIF, true);
        const ki = ease.back(P(t, 15.5, 15.88)), kt = P(t, 16.35, 16.72);
        const palavra = (s, dy, a, bl) => {
          if (a <= .003) return;
          x.save(); x.globalAlpha *= a; if (bl > .3) x.filter = `blur(${bl}px)`;
          texto(x, s, 540, CY + 95 + dy, fonte, C.champ);
          x.restore();
        };
        palavra('sob medida.', 80 * (1 - ki) - 90 * ease.inOut(kt), clamp(P(t, 15.5, 15.7)) * (1 - kt), 12 * (1 - ki) + 14 * kt);
        palavra('com método.', 90 * (1 - ease.back(kt)), ease.out(kt), 14 * (1 - ease.out(kt)));
      }));
    } },

    // 12b · "à altura do seu negócio." entra em degraus e sai para a esquerda com rastro
    { a: 17.25, b: 18.74, draw(g, t) {
      const kx = ease.in(P(t, 18.42, 18.74));
      const de = { dx: 60, dy: 80, s: .6, blur: 12 };
      camada(g, { alpha: 1 - kx, mx: -190 * kx }, x => {
        x.translate(-320 * kx, 0);
        frase(x, t, [{ text: 'à altura', t0: 17.3, font: F(600, 132, SERIF, true), color: C.champ }], { x: 540, y: CY - 30, dur: .5, de });
        frase(x, t, ['do', 'seu', 'negócio.'].map((text, i) => ({ text, t0: 17.48 + i * .1, font: F(600, 84, SERIF), color: C.marfim })),
          { x: 540, y: CY + 90, gap: 22, dur: .5, de });
      });
    } },

    // 13 · símbolo gira em 3D, abre espaço para "NEXO" e a assinatura
    { a: 18.68, b: 21.06, draw(g, t) {
      const kg = P(t, 18.68, 19.5), ke = ease.out(P(t, 18.68, 18.96));
      const giro = Math.cos((1 - ease.out(kg)) * Math.PI * 4);
      const nexo = { text: 'NEXO', font: F(600, 124, SERIF), ls: 22 };
      const itens = [
        { w: 150, t0: 18.68, dur: .01, de: { s: 1, dy: 0, blur: 0 }, draw: x => {
          x.save(); x.translate(0, -44); x.scale(giro, 1);
          simbolo(x, 0, 0, 190);
          x.restore();
        } },
        { w: largura(nexo), t0: 19.6, dur: .55, de: { s: 1, dy: 0, blur: 0 }, ease: ease.out, draw: x => {
          // letras caem uma a uma
          let lx = -largura(nexo) / 2;
          for (let j = 0; j < 4; j++) {
            const l = 'NEXO'[j], lw = largura({ text: l, font: nexo.font, ls: nexo.ls });
            const kl = P(t, 19.62 + j * .07, 20.02 + j * .07);
            if (kl > 0) {
              x.save(); x.globalAlpha *= ease.out(kl);
              if (kl < 1) x.filter = `blur(${8 * (1 - ease.out(kl))}px)`;
              texto(x, l, lx, 70 * (1 - ease.back(kl)), nexo.font, C.marfim, 'left', nexo.ls);
              x.restore();
            }
            lx += lw;
          }
        } },
      ];
      const kx = ease.in(P(t, 20.76, 21.06));
      camada(g, { alpha: 1 - kx, blur: 8 * kx, mx: 120 * (1 - ke) }, x => em(x, 540, CY, lerp(1, .55, kx), 0, x => {
        x.translate(330 * (1 - ke), 0);
        frase(x, t, itens, { x: 540, y: CY + 44, gap: 40, dur: .5 });
        const kl = ease.out(P(t, 20.0, 20.32));
        x.fillStyle = C.champ; x.fillRect(540 - 50 * kl, CY + 112, 100 * kl, 2.5);
        const kt = P(t, 20.12, 20.48);
        x.save(); x.globalAlpha *= kt;
        texto(x, 'OPERAÇÕES QUE TRANSFORMAM', 540, CY + 180 + 20 * (1 - ease.out(kt)), F(500, 27, SANS), C.champ, 'center', 9);
        x.restore();
      }));
    } },

    // 14 · fundo quase preto com brilho pulsando e "NEXO" grande
    { a: 21.02, b: 22.52, draw(g, t) {
      const ki = ease.out(P(t, 21.02, 21.45)), kx = P(t, 22.28, 22.52);
      camada(g, { alpha: 1 - kx }, x => {
        x.fillStyle = '#110304'; x.fillRect(-300, -300, W + 600, H + 600);
        const r = 560 * (1 + .06 * Math.sin(t * 6)) * lerp(.6, 1, ki);
        const gr = x.createRadialGradient(540, CY, 0, 540, CY, r);
        gr.addColorStop(0, rgba(C.marfim, .26 * ki)); gr.addColorStop(.45, rgba(C.champ, .14 * ki)); gr.addColorStop(1, rgba(C.champ, 0));
        x.fillStyle = gr; x.fillRect(-300, -300, W + 600, H + 600);
        x.save();
        if (ki < 1) x.filter = `blur(${22 * (1 - ki)}px)`;
        x.translate(540, CY); const s = lerp(1.6, 1, ki) * (1 - .03 * P(t, 21.45, 22.5)); x.scale(s, s);
        x.shadowColor = rgba(C.champ, .5); x.shadowBlur = 50;
        texto(x, 'NEXO', 0, 58, F(600, 170, SERIF), C.marfim, 'center', 30);
        x.restore();
      });
    } },

    // 15 · fecho: símbolo, nome, CTA com camadas deslocadas e o grafismo de pontos
    { a: 22.45, b: DUR + 1, draw(g, t) {
      const ks = ease.back(P(t, 22.48, 22.8));
      g.save(); g.translate(540, 740); g.scale(lerp(.6, 1, ks), lerp(.6, 1, ks));
      simbolo(g, 0, 0, 200, P(t, 22.5, 23.25));
      g.restore();
      const kn = ease.out(P(t, 22.78, 23.15));
      g.save(); g.globalAlpha *= kn;
      texto(g, 'NEXO', 540, 1000 + 40 * (1 - kn), F(600, 112, SERIF), C.marfim, 'center', 22);
      g.restore();

      const kw = ease.out(P(t, 23.0, 23.36)), o = lerp(20, 5, ease.inOut(P(t, 23.2, 23.65)));
      if (kw > 0) {
        const w = 540 * kw, y = 1185;
        caixa(g, 540 - o, y - o * .6, w, 118, 59, rgba(C.marfim, .85), null, false);
        caixa(g, 540 + o, y + o * .6, w, 118, 59, C.vinhoM, rgba(C.champ, .5), false);
        caixa(g, 540, y, w, 118, 59, C.champ, null, false);
        const kt = P(t, 23.35, 23.62);
        g.save(); g.globalAlpha *= kt;
        texto(g, 'Quero meu site', 520, y + 15, F(600, 42, SANS), C.vinho);
        icone(g, 'seta', 700 + 10 * (1 - kt) + 6 * Math.sin(t * 5) * P(t, 23.8, 24), y, 36, C.vinho, 2.2);
        g.restore();
      }

      // grafismo "pontos que se ligam"
      const pts = [[-240, 24], [-120, -22], [0, 16], [120, -12], [240, 12]].map(([px, py]) => [540 + px, 1360 + py]);
      const kl = P(t, 23.55, 24.1) * (pts.length - 1);
      g.save(); g.strokeStyle = C.champ; g.lineWidth = 3; g.fillStyle = C.champ; g.lineCap = 'round';
      for (let i = 0; i < pts.length - 1; i++) {
        const k = clamp(kl - i);
        if (k <= 0) break;
        g.beginPath(); g.moveTo(...pts[i]); g.lineTo(lerp(pts[i][0], pts[i + 1][0], k), lerp(pts[i][1], pts[i + 1][1], k)); g.stroke();
      }
      pts.forEach((p, i) => {
        const r = kl > 0 ? 11 * ease.back(clamp(kl - i + .5)) : 0;
        if (r > 0) { g.beginPath(); g.arc(p[0], p[1], r, 0, Math.PI * 2); g.fill(); }
      });
      g.restore();

      const kr = P(t, 23.95, 24.35);
      g.save(); g.globalAlpha *= kr;
      texto(g, 'Sites · Automação · Planilhas e agenda · Sistemas', 540, 1480 + 16 * (1 - ease.out(kr)), F(400, 28, SANS), C.cinza);
      g.restore();
    } },
  ];

  /* Trechos desacelerados para a narração caber em ritmo natural: [início, fim, fator] em tempo de
     animação. O mesmo mapa está no gerador da trilha (video/audio/gerar_trilha.py). */
  const TRECHOS = [[5.6, 9.4, 1.55], [10.98, 14.64, 1.4]];
  const DURACAO = DUR + TRECHOS.reduce((s, [a, b, f]) => s + (b - a) * (f - 1), 0);
  function tempoCena(T) {
    let atraso = 0;
    for (const [a, b, f] of TRECHOS) {
      const va = a + atraso, vb = va + (b - a) * f;
      if (T < va) break;
      if (T < vb) return a + (T - va) / f;
      atraso += (b - a) * (f - 1);
    }
    return T - atraso;
  }

  // T = tempo do vídeo (o mesmo da narração)
  function render(T) {
    const t = tempoCena(T);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1; ctx.filter = 'none';
    fundo(ctx, t);
    camera(ctx, t);
    for (const c of CENAS) {
      if (t < c.a || t >= c.b) continue;
      if (c.zoom) em(ctx, 540, CY, c.zoom, 0, g => c.draw(g, t));
      else c.draw(ctx, t);
    }
  }

  /* ---------- player ---------- */
  const params = new URLSearchParams(location.search);
  const ui = {
    tocar: document.getElementById('tocar'), reiniciar: document.getElementById('reiniciar'),
    linha: document.getElementById('linha'), tempo: document.getElementById('tempo'), baixar: document.getElementById('baixar'),
  };
  const narracao = document.getElementById('narracao');
  let tocando = false, atual = 0, inicio = 0, gravador = null, audioCtx = null, saidaAudio = null;
  ui.linha.max = DURACAO;

  const somAcompanha = () => {
    if (!tocando) { narracao.pause(); return; }
    if (atual >= narracao.duration) return;
    if (narracao.paused || Math.abs(narracao.currentTime - atual) > .12) narracao.currentTime = atual;
    if (narracao.paused) narracao.play().catch(() => {});
  };
  const fmt = s => s.toFixed(1).replace('.', ',');

  function quadro(agora) {
    if (tocando) {
      atual = (agora - inicio) / 1000;
      if (atual >= DURACAO) {
        if (gravador) { render(DURACAO - .001); gravador.stop(); gravador = null; }
        atual %= DURACAO; inicio = agora - atual * 1000;
      }
      somAcompanha();
    }
    render(atual);
    ui.linha.value = atual;
    ui.tempo.textContent = `${fmt(atual)} / ${fmt(DURACAO)}s`;
    requestAnimationFrame(quadro);
  }
  const irPara = s => { atual = s; inicio = performance.now() - s * 1000; narracao.currentTime = Math.min(s, narracao.duration || s); somAcompanha(); };
  const estado = v => {
    tocando = v;
    ui.tocar.textContent = v ? '❚❚' : '▶';
    ui.tocar.setAttribute('aria-label', v ? 'Pausar' : 'Tocar');
    if (v) irPara(atual >= DURACAO ? 0 : atual); else narracao.pause();
  };

  ui.tocar.onclick = () => estado(!tocando);
  ui.reiniciar.onclick = () => irPara(0);
  ui.linha.oninput = () => { irPara(+ui.linha.value); };

  ui.baixar.onclick = () => {
    let stream;
    try { stream = canvas.captureStream(30); } catch (err) {
      alert('Abra esta página por um servidor (ex.: GitHub Pages ou "npx serve") para gravar o vídeo.');
      return;
    }
    // a trilha (voz + efeitos) entra na gravação pelo Web Audio (o som continua saindo nos alto-falantes)
    if (!audioCtx) {
      audioCtx = new AudioContext();
      const origem = audioCtx.createMediaElementSource(narracao);
      saidaAudio = audioCtx.createMediaStreamDestination();
      origem.connect(audioCtx.destination); origem.connect(saidaAudio);
    }
    audioCtx.resume();
    saidaAudio.stream.getAudioTracks().forEach(tr => stream.addTrack(tr));
    const tipos = ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
    const tipo = tipos.find(m => window.MediaRecorder && MediaRecorder.isTypeSupported(m));
    if (!tipo) { alert('Este navegador não grava vídeo do canvas.'); return; }
    const partes = [];
    const rec = new MediaRecorder(stream, { mimeType: tipo, videoBitsPerSecond: 12e6 });
    rec.ondataavailable = e => e.data.size && partes.push(e.data);
    rec.onstop = () => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob(partes, { type: tipo }));
      a.download = 'nexo-video.' + (tipo.startsWith('video/mp4') ? 'mp4' : 'webm');
      a.click();
      ui.baixar.disabled = false; ui.baixar.textContent = 'Baixar vídeo';
    };
    ui.baixar.disabled = true; ui.baixar.textContent = 'Gravando…';
    atual = 0;
    estado(true);
    rec.start();
    gravador = rec;
  };

  const pronto = Promise.all([
    document.fonts.load(F(600, 40, SERIF)), document.fonts.load(F(600, 40, SERIF, true)),
    document.fonts.load(F(500, 40, SANS)), document.fonts.load(F(400, 40, SANS)),
    ...FOTOS.map(i => (i.complete ? null : new Promise(ok => { i.onload = i.onerror = ok; }))),
  ]);

  // ?quadro=12.5 desenha um quadro parado; ?exportar deixa window.nexoRender para captura quadro a quadro
  window.nexoRender = render;
  window.nexoDuracao = DURACAO;
  window.nexoPronto = pronto;
  pronto.then(() => {
    if (params.has('exportar')) { document.body.classList.add('exportando'); render(0); return; }
    if (params.has('quadro')) atual = +params.get('quadro');
    inicio = performance.now() - atual * 1000;
    requestAnimationFrame(quadro);
  });
})();
