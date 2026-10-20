"""Gera a trilha do vídeo (video/trilha.m4a): narração feminina + efeitos sonoros + fundo musical.

Narração: Kokoro v1.0, voz brasileira "pf_dora" (Apache-2.0), rodando local pelo sherpa-onnx.
Efeitos e fundo: sintetizados aqui mesmo (ruído filtrado, senoides), sem amostras de terceiros.

  pip install sherpa-onnx soundfile numpy scipy
  curl -L https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-multi-lang-v1_0.tar.bz2 | tar xj
  python3 gerar_trilha.py kokoro-multi-lang-v1_0 trilha.wav
  ffmpeg -i trilha.wav -c:a aac -b:a 160k ../trilha.m4a

Todos os tempos abaixo estão em tempo de animação (o mesmo de nexo-video.js); TRECHOS precisa
ser igual ao do JS, que desacelera algumas cenas para a fala caber.
"""
import sys
import numpy as np
import scipy.signal as ss
import soundfile as sf

SR = 48000
TRECHOS = [(5.6, 9.4, 1.55), (10.98, 14.64, 1.4)]


def video(t):
    atraso = 0
    for a, b, f in TRECHOS:
        if t < a:
            break
        if t < b:
            return t + atraso + (t - a) * (f - 1)
        atraso += (b - a) * (f - 1)
    return t + atraso


DUR = video(25.0)
rng = np.random.default_rng(7)

# ---------- narração: (início, fim máximo, texto); começa quando a legenda aparece ----------
FALAS = [
    (0.05, 1.30, "Deixa eu adivinhar..."),
    (2.62, 3.80, "Seu negócio é melhor..."),
    (3.85, 5.65, "do que o seu site mostra hoje."),
    (5.66, 6.95, "Seu site está desatualizado."),
    (7.00, 8.36, "E a planilha ainda é atualizada à mão."),
    (8.42, 9.40, "Quero meu site!"),
    (9.40, 11.00, "Boas-vindas ao Nexo."),
    (11.06, 12.20, "Criação de sites."),
    (12.20, 13.34, "Automatizar a rotina."),
    (13.30, 14.56, "Planilhas e agenda em ordem!"),
    (14.60, 16.40, "Um site feito sob medida..."),
    (16.42, 17.28, "com método."),
    (17.30, 18.72, "à altura do seu negócio."),
    (19.60, 21.90, "Nexo, operações que transformam."),
    (23.35, 24.95, "Quero meu site."),
]


def narracao(dir_modelo):
    import sherpa_onnx
    K = dir_modelo.rstrip('/') + '/'
    tts = sherpa_onnx.OfflineTts(sherpa_onnx.OfflineTtsConfig(model=sherpa_onnx.OfflineTtsModelConfig(
        kokoro=sherpa_onnx.OfflineTtsKokoroModelConfig(
            model=K + 'model.onnx', voices=K + 'voices.bin', tokens=K + 'tokens.txt',
            data_dir=K + 'espeak-ng-data', lang='pt-br'),
        num_threads=4)))
    voz = np.zeros(int(DUR * SR) + SR, np.float32)
    for a, b, txt in FALAS:
        ini, fim = video(a), video(b)
        vel = 1.0
        while True:
            g = tts.generate(txt, sid=42, speed=vel)  # 42 = pf_dora
            x = np.array(g.samples, np.float32)
            nz = np.where(np.abs(x) > .01)[0]
            x = x[max(0, nz[0] - 240): nz[-1] + 1200]
            dur = len(x) / g.sample_rate
            if ini + dur <= fim + .03 or vel >= 1.12:
                break
            vel = round(min(1.12, vel * dur / (fim - ini) * 1.01), 3)
        x = ss.resample_poly(x, SR, g.sample_rate).astype(np.float32)
        i = int(ini * SR)
        voz[i:i + len(x)] += x[:len(voz) - i]
        print(f"{'ok   ' if ini + dur <= fim + .03 else 'PASSA'} {ini:6.2f}–{ini + dur:6.2f} (até {fim:6.2f}) vel {vel:.2f}  {txt}")
    return voz / np.max(np.abs(voz))


# ---------- síntese de efeitos ----------
def env(n, ataque, queda, forma=3.0):
    t = np.linspace(0, 1, n)
    a = int(n * ataque)
    e = np.ones(n)
    if a:
        e[:a] = np.linspace(0, 1, a) ** 2
    e[a:] = (1 - np.linspace(0, 1, n - a)) ** forma if queda else e[a:]
    return e


def faixa(x, f1, f2, ordem=2):
    sos = ss.butter(ordem, [max(20, f1), min(SR / 2 - 100, f2)], 'band', fs=SR, output='sos')
    return ss.sosfilt(sos, x)


def passa_baixa(x, f):
    return ss.sosfilt(ss.butter(2, f, 'low', fs=SR, output='sos'), x)


def passa_alta(x, f):
    return ss.sosfilt(ss.butter(2, f, 'high', fs=SR, output='sos'), x)


def whoosh(dur=.45, f0=300, f1=3000, pan0=-.6, pan1=.6, pico=.55):
    """Ar passando: ruído em várias bandas que acendem em sequência (varredura suave de f0 a f1)."""
    n = int(dur * SR)
    ruido = rng.standard_normal(n)
    t = np.linspace(0, 1, n)
    saida = np.zeros(n)
    bandas = np.geomspace(min(f0, 6000), min(f1, 6000), 8)
    for k, fc in enumerate(bandas):
        c = k / (len(bandas) - 1)
        janela = np.exp(-((t - c * .8 - .1) / .22) ** 2)
        saida += faixa(ruido, fc / 1.5, fc * 1.5) * janela
    e = np.where(t < pico, (t / pico) ** 2, ((1 - t) / (1 - pico)) ** 1.6)
    saida *= e
    saida /= np.max(np.abs(saida)) + 1e-9
    pan = np.linspace(pan0, pan1, n)
    return np.stack([saida * np.sqrt((1 - pan) / 2), saida * np.sqrt((1 + pan) / 2)], 1)


def pop(f0=900, f1=320, dur=.09, brilho=.25):
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = f1 + (f0 - f1) * np.exp(-t * 60)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 38)
    clique = passa_alta(rng.standard_normal(n), 3000) * np.exp(-t * 900) * brilho
    return mono(x + clique)


def tick(f=2400, dur=.035, nivel=1.0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    x = np.sin(2 * np.pi * f * t) * np.exp(-t * 140) * .6 + faixa(rng.standard_normal(n), f * .8, f * 2.5) * np.exp(-t * 400) * .5
    return mono(x * nivel)


def clique(nivel=1.0):
    a = tick(3200, .03) * .9
    b = tick(1800, .05) * .7
    s = np.zeros((int(.11 * SR), 2))
    s[:len(a)] += a
    s[int(.045 * SR):int(.045 * SR) + len(b)] += b
    return s * nivel


def impacto(dur=1.6, grave=48, forca=1.0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = grave + 90 * np.exp(-t * 18)
    sub = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 3.2)
    corpo = passa_baixa(rng.standard_normal(n), 900) * np.exp(-t * 14) * .8
    ar = passa_baixa(passa_alta(rng.standard_normal(n), 2500), 7000) * np.exp(-t * 22) * .12
    return mono(np.tanh((sub * 1.2 + corpo + ar) * 1.3) * forca)


def subida(dur=1.0, f0=200, f1=2400):
    """Riser: ruído que sobe de tom e de volume, com uma senoide deslizando junto."""
    w = whoosh(dur, f0, f1, -.2, .2, pico=.92)
    n = len(w)
    t = np.arange(n) / SR
    f = f0 * (f1 / f0) ** (t / dur) * .5
    tom = np.sin(2 * np.pi * np.cumsum(f) / SR) * (t / dur) ** 2 * .25
    return w + mono(tom)


def reverso(dur=.6):
    n = int(dur * SR)
    t = np.linspace(0, 1, n)
    x = passa_alta(rng.standard_normal(n), 1800) * t ** 3
    return mono(x / np.max(np.abs(x)))


def brilho(dur=1.0, base=1046.5, notas=(0, 4, 7, 11, 12, 16), passo=.07):
    """Cintilado: arpejo rápido de sinos agudos (acorde de dó maior com sétima)."""
    n = int(dur * SR)
    s = np.zeros((n, 2))
    for k, st in enumerate(notas):
        f = base * 2 ** (st / 12)
        i = int(k * passo * SR)
        m = n - i
        t = np.arange(m) / SR
        x = (np.sin(2 * np.pi * f * t) + .3 * np.sin(2 * np.pi * f * 2.01 * t)) * np.exp(-t * 4.5) * (1 - np.exp(-t * 400))
        p = -.5 + k / (len(notas) - 1)
        s[i:, 0] += x * np.sqrt((1 - p) / 2)
        s[i:, 1] += x * np.sqrt((1 + p) / 2)
    return s / np.max(np.abs(s))


def sino(f=1318.5, dur=.9):
    n = int(dur * SR)
    t = np.arange(n) / SR
    x = sum(a * np.sin(2 * np.pi * f * h * t) * np.exp(-t * d) for h, a, d in [(1, 1, 5), (2.76, .35, 9), (5.4, .15, 14)])
    return mono(x * (1 - np.exp(-t * 600)))


def alerta():
    a, b = sino(1046.5, .5), sino(1318.5, .8)
    s = np.zeros((len(b) + int(.09 * SR), 2))
    s[:len(a)] += a * .8
    s[int(.09 * SR):] += b
    return s


def bolha(f0=180, f1=620, dur=.22):
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = f0 + (f1 - f0) * (t / dur) ** .6 + 25 * np.sin(2 * np.pi * 30 * t)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.sin(np.pi * t / dur) ** 1.5
    return mono(x)


def carregando(dur=.85):
    """Tom de progresso que sobe e "trava" com uma leve oscilação."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = 330 + 260 * (1 - np.exp(-t * 4)) + 6 * np.sin(2 * np.pi * 7 * t)
    x = (np.sin(2 * np.pi * np.cumsum(f) / SR) + .25 * np.sin(4 * np.pi * np.cumsum(f) / SR))
    return mono(x * env(n, .15, True, 1.2) * .5)


def glitch(dur=.32):
    n = int(dur * SR)
    x = np.zeros(n)
    i = 0
    while i < n:
        m = int(rng.uniform(.012, .035) * SR)
        f = rng.choice([220, 440, 660, 880, 1320])
        t = np.arange(min(m, n - i)) / SR
        x[i:i + len(t)] = np.sign(np.sin(2 * np.pi * f * t)) * rng.uniform(.3, .8) * (rng.random() > .25)
        i += m
    return mono(passa_baixa(x, 5000) * env(n, .05, True, 1.5) * .6)


def mono(x):
    x = np.asarray(x, float)
    return np.stack([x, x], 1) * .7071


# ---------- roteiro de efeitos: (tempo de animação, efeito, volume) ----------
def roteiro():
    E = []
    add = lambda t, s, v=1.0: E.append((t, s, v))
    # 1 · palavras em cascata e saída para a direita
    for k, t in enumerate([.05, .17, .29]):
        add(t, pop(700 + 140 * k, 300, .08), .35)
    add(.93, whoosh(.42, 500, 4500, -.3, .9), .55)
    # 2 · tile surge, leque abre com o mural
    add(1.05, pop(1100, 260, .14), .7)
    add(1.28, subida(1.15, 180, 2600), .55)
    # 3 · impacto + onda de choque, palavras no tile, zoom forte
    add(2.4, impacto(1.4, 46), .95)
    add(2.4, whoosh(.55, 150, 1200, 0, 0, pico=.15), .45)
    for k, t in enumerate([2.68, 2.95, 3.18, 3.33]):
        add(t, pop(650 + 120 * k, 260, .1), .55)
    add(3.42, subida(.42, 400, 5000), .6)
    # 4 · frase cresce, "mostra hoje." entra, saída com rastro
    for k in range(5):
        add(3.85 + k * .075, tick(1800 + 160 * k, .03), .22)
    add(4.52, whoosh(.38, 600, 3500, .9, 0), .45)
    add(5.02, pop(820, 330, .09), .45)
    add(5.38, whoosh(.36, 700, 5000, -.2, .9), .5)
    # 5 · cartão de alerta
    add(5.56, whoosh(.4, 300, 2500, .7, 0), .45)
    add(5.69, alerta(), .32)
    for k in range(4):
        add(5.78 + k * .11, tick(2000 + 150 * k, .03), .2)
    for k in range(4):
        add(6.6 + k * .05, tick(2600 - 150 * k, .025), .14)
    # 6 · vira arquivo de planilha, digitação, barra de progresso, vira pílula
    add(6.85, bolha(220, 520, .2), .32)
    for k in range(11):
        add(6.98 + k * .036, tick(rng.uniform(2600, 3600), .022), .2)
    add(7.15, carregando(.85), .18)
    add(8.06, bolha(520, 160, .26), .38)
    # 7 · CTA: palavras, balanço, clique e subida
    add(8.38, pop(760, 320, .08), .4)
    add(8.55, pop(900, 360, .08), .4)
    add(8.6, whoosh(.18, 900, 2600, -.4, .4), .18)
    add(8.78, whoosh(.18, 900, 2600, .4, -.4), .18)
    add(8.86, clique(), .7)
    add(9.02, whoosh(.38, 400, 4500, 0, 0), .5)
    # 8 · "Boas-vindas ao" + símbolo que se desenha
    add(9.4, pop(700, 300, .08), .35)
    add(9.56, pop(820, 320, .08), .35)
    add(9.72, brilho(1.1, 1046.5), .3)
    add(10.6, whoosh(.38, 3500, 400, 0, 0, pico=.3), .4)
    # 9 · cartão "Criação de sites"
    add(10.96, whoosh(.36, 300, 2800, -.6, 0), .4)
    add(11.08, pop(1000, 380, .1), .4)
    for k in range(3):
        add(11.18 + k * .09, tick(2100 + 200 * k, .03), .2)
    add(11.93, whoosh(.3, 2000, 500, 0, .3, pico=.3), .32)
    # 10 · pílula "Automatizar a rotina"
    add(12.18, bolha(160, 640, .24), .38)
    add(12.28, pop(940, 360, .08), .3)
    add(12.52, pop(1050, 420, .08), .38)
    add(12.96, whoosh(.4, 500, 4500, .2, -.8), .5)
    # 11 · etiqueta que gira, cresce e desfoca
    add(13.28, whoosh(.42, 300, 3000, -.7, .3), .45)
    for k in range(5):
        add(13.32 + k * .07, tick(1700 + 180 * k, .03), .2)
    add(14.3, subida(.36, 500, 4500), .45)
    # 12 · "Um site feito" + troca "sob medida." → "com método."
    for k in range(3):
        add(14.65 + k * .12, pop(620 + 110 * k, 280, .08), .32)
    add(15.5, pop(980, 420, .1), .35)
    add(15.5, brilho(.7, 1567.98, (0, 4, 7, 12), .05), .14)
    add(16.32, whoosh(.32, 600, 3200, 0, 0, pico=.4), .42)
    add(16.98, whoosh(.32, 2400, 500, 0, 0, pico=.3), .3)
    # 12b · "à altura do seu negócio." e saída para a esquerda
    add(17.25, whoosh(.4, 300, 2600, .7, 0), .42)
    for k in range(3):
        add(17.48 + k * .1, pop(700 + 110 * k, 300, .08), .3)
    add(18.4, whoosh(.38, 700, 5000, .2, -.9), .5)
    # 13 · símbolo gira em 3D, letras caem, linha e assinatura
    add(18.66, whoosh(.85, 250, 2200, .9, -.3), .5)
    add(18.66, subida(.8, 300, 1600), .2)
    for k in range(4):
        add(19.62 + k * .07, pop(600 + 150 * k, 280, .09), .38)
    add(20.0, brilho(.9, 1318.5, (0, 3, 7, 12), .06), .22)
    add(20.74, whoosh(.36, 3000, 400, 0, 0, pico=.3), .4)
    # 14 · fundo escuro com brilho e "NEXO" grande
    add(20.42, reverso(.6), .45)
    add(21.02, impacto(2.2, 40, 1.0), 1.0)
    add(21.02, brilho(1.6, 523.25, (0, 7, 12, 16, 19, 24), .05), .3)
    # 15 · fecho: símbolo se desenha, nome, CTA com glitch, pontos
    add(22.48, brilho(1.0, 1046.5), .26)
    add(22.78, pop(700, 280, .1), .35)
    add(22.98, whoosh(.36, 400, 3000, -.5, .5), .4)
    add(23.0, glitch(.3), .22)
    add(23.36, clique(), .55)
    for k in range(5):
        add(23.55 + k * .135, tick(1400 * 2 ** (k * 2 / 12), .05), .32)
    add(24.0, sino(1567.98, 1.2), .18)
    return E


def reverb(x, dur=1.1, wet=.18):
    n = int(dur * SR)
    t = np.arange(n) / SR
    ir = rng.standard_normal((n, 2)) * np.exp(-t * 5.5)[:, None]
    ir = np.stack([passa_baixa(ir[:, 0], 6000), passa_baixa(ir[:, 1], 6000)], 1)
    ir /= np.sqrt(np.sum(ir ** 2, 0))
    m = np.stack([ss.fftconvolve(x[:, c], ir[:, c])[:len(x)] for c in range(2)], 1)
    return x + wet * m


def fundo_musical(n):
    """Pad discreto: acordes lentos (Lá menor 9, Fá maior 7, Dó, Sol) com serrilhas desafinadas e filtradas."""
    t = np.arange(n) / SR
    acordes = [(57, 60, 64, 67, 71), (53, 57, 60, 64, 69), (48, 55, 60, 64, 67), (55, 59, 62, 67, 71)]
    dur_acorde = DUR / 4
    s = np.zeros((n, 2))
    for k, ac in enumerate(acordes):
        i0 = int(max(0, k * dur_acorde - .8) * SR)
        i1 = int(min(DUR + 1, (k + 1) * dur_acorde + .8) * SR)
        tt = t[i0:i1] - t[i0]
        L = len(tt)
        e = np.minimum(1, np.minimum(tt / 1.2, (tt[-1] - tt) / 1.2)) if L else tt
        for nota in ac:
            f = 440 * 2 ** ((nota - 69) / 12)
            for c, det in enumerate((-.12, .12)):
                fd = f * 2 ** (det / 12)
                saw = 2 * ((fd * tt + rng.random()) % 1) - 1
                s[i0:i1, c] += saw * e
    s = np.stack([passa_baixa(passa_baixa(s[:, c], 900), 900) for c in range(2)], 1)
    trem = .8 + .2 * np.sin(2 * np.pi * .25 * t)
    return s * trem[:, None] / np.max(np.abs(s))


def main():
    dir_modelo, saida = sys.argv[1], sys.argv[2]
    n = int(DUR * SR) + SR // 2
    voz = narracao(dir_modelo)[:n]
    voz = np.pad(voz, (0, n - len(voz)))

    efeitos = np.zeros((n, 2))
    for t, s, v in roteiro():
        i = int(video(t) * SR)
        m = min(len(s), n - i)
        efeitos[i:i + m] += s[:m] * v
    efeitos = reverb(efeitos)

    pad = fundo_musical(n)

    # abaixa efeitos e fundo enquanto a voz fala (ducking suave)
    nivel = np.convolve(np.abs(voz), np.ones(int(.05 * SR)) / int(.05 * SR), 'same')
    fala = np.clip(nivel / .05, 0, 1)
    fala = passa_baixa(fala, 6)
    duck_fx = 1 - .3 * fala
    duck_pad = 1 - .45 * fala

    vozst = reverb(np.stack([voz, voz], 1) * .7071, .8, .06)
    mix = vozst * 1.0 + efeitos * .55 * duck_fx[:, None] + pad * .09 * duck_pad[:, None]
    # fade de entrada/saída do fundo e limitador simples
    mix[-int(.4 * SR):] *= np.linspace(1, 0, int(.4 * SR))[:, None]
    mix = np.tanh(mix * 1.1) / np.tanh(1.1)
    mix *= .95 / np.max(np.abs(mix))
    sf.write(saida, mix.astype(np.float32), SR)
    if len(sys.argv) > 3:  # faixas separadas para conferência
        for nome, x in [('voz', vozst), ('efeitos', efeitos * .55 * duck_fx[:, None]), ('fundo', pad * .09 * duck_pad[:, None])]:
            sf.write(f'{sys.argv[3]}/{nome}.wav', x.astype(np.float32), SR)
    print(f'trilha: {n / SR:.2f}s → {saida}')


if __name__ == '__main__':
    main()
