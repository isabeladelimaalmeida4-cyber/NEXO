"""Gera a trilha do vídeo (video/trilha.m4a): dublagem gravada + efeitos sonoros + fundo musical.

Voz: a gravação da dublagem (video/audio/dublagem.m4a), usada inteira. Só duas pausas entre frases
ficam mais longas (PAUSAS) para a abertura do mural e a entrada do símbolo terem tempo de tela.
Efeitos e fundo: sintetizados aqui mesmo (ruído filtrado, senoides), sem amostras de terceiros.

  pip install soundfile numpy scipy
  python3 gerar_trilha.py dublagem.m4a trilha.wav
  ffmpeg -i trilha.wav -c:a aac -b:a 160k ../trilha.m4a

Os efeitos são marcados em tempo de animação (o mesmo de nexo-video.js) e convertidos para o tempo
do vídeo pelas ÂNCORAS, que precisam ser iguais às do JS.
"""
import subprocess
import sys
import numpy as np
import scipy.signal as ss
import soundfile as sf

SR = 48000

# (tempo de animação, tempo do vídeo): cada momento-chave da animação cai quando a palavra é dita.
# Entre âncoras o tempo é linear; antes da primeira e depois da última, velocidade normal.
ANCORAS = [
    (0, 0), (.05, .62), (.29, 1.0), (.95, 1.75), (1.05, 1.85), (2.4, 3.0),
    (2.68, 3.06), (2.95, 3.32), (3.18, 3.85), (3.33, 4.0), (3.55, 4.25),
    (3.85, 4.42), (4.6, 4.97), (5.02, 5.5), (5.42, 6.0),
    (5.6, 6.15), (5.78, 6.36), (5.89, 6.75), (6.0, 7.35), (6.11, 7.6), (6.55, 8.3),
    (6.85, 8.45), (6.98, 8.55), (7.2, 9.0), (8.0, 11.5), (8.08, 11.75),
    (8.36, 12.0), (8.4, 12.36), (8.76, 13.4), (8.84, 14.2), (9.05, 15.15),
    (9.4, 15.44), (9.56, 15.75), (9.72, 16.1), (10.05, 16.45), (10.62, 17.7),
    (10.98, 17.95), (11.18, 18.25), (11.27, 18.55), (11.6, 19.1), (11.78, 19.97), (11.95, 21.1),
    (12.18, 21.4), (12.32, 21.63), (12.52, 22.46), (12.98, 23.0),
    (13.32, 23.3), (13.39, 24.55), (13.46, 24.75), (13.53, 26.0), (13.6, 26.3), (14.3, 27.85),
    (14.6, 28.2), (14.65, 28.34), (14.89, 28.9), (15.5, 29.3), (16.35, 30.6), (16.72, 31.25), (17.0, 31.85),
    (17.3, 32.1), (17.56, 32.55), (18.42, 33.65), (18.68, 33.9), (19.62, 34.85), (20.12, 35.37),
    (20.76, 36.9), (21.02, 37.05), (22.28, 37.9), (22.45, 38.0), (23.0, 38.5), (23.4, 38.9),
    (24.6, 40.3), (25.0, 41.0),
]


def video(t):
    for (a0, v0), (a1, v1) in zip(ANCORAS, ANCORAS[1:]):
        if t <= a1:
            return v0 + (max(t, a0) - a0) * (v1 - v0) / (a1 - a0)
    return ANCORAS[-1][1] + t - ANCORAS[-1][0]


DUR = video(25.0)
rng = np.random.default_rng(7)

# pausas alongadas na gravação: (tempo na gravação original, segundos de silêncio a mais)
PAUSAS = [(1.80, 1.0), (32.78, .8)]


def dublagem(arquivo):
    """Lê a gravação, limpa (corta graves, compressão leve, volume padrão) e alonga as PAUSAS."""
    bruto = subprocess.run(
        ['ffmpeg', '-v', 'error', '-i', arquivo, '-af',
         'highpass=f=80,acompressor=threshold=-22dB:ratio=2.5:attack=8:release=150,loudnorm=I=-16:TP=-1.5:LRA=7',
         '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-'], capture_output=True, check=True).stdout
    x = np.frombuffer(bruto, np.float32)
    partes, ini = [], 0
    for t, extra in PAUSAS:
        i = int(t * SR)
        partes += [x[ini:i], np.zeros(int(extra * SR), np.float32)]
        ini = i
    partes.append(x[ini:])
    voz = np.concatenate(partes)
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
    # 4 · "e mesmo assim" cresce, "não dá conta." entra, saída com rastro
    for k in range(3):
        add(3.85 + k * .075, tick(1800 + 160 * k, .03), .22)
    add(4.52, whoosh(.38, 600, 3500, .9, 0), .45)
    add(5.02, pop(820, 330, .09), .45)
    add(5.38, whoosh(.36, 700, 5000, -.2, .9), .5)
    # 5 · notificação de mensagens: pings que se acumulam
    add(5.56, whoosh(.4, 300, 2500, .7, 0), .45)
    add(5.69, alerta(), .3)
    for k in range(3):
        add(6.0 + k * .14, sino(1760 + 220 * k, .35), .12)
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
    # 7 · contador de horas perdidas: tiques acelerando e um baque quando para em 156
    add(8.36, pop(760, 320, .08), .4)
    for k in range(16):
        add(8.4 + .36 * (1 - (1 - k / 16) ** .5), tick(1500 + 70 * k, .025), .22)
    add(8.46, pop(900, 360, .08), .3)
    add(8.76, impacto(.7, 62, .8), .55)
    add(9.02, whoosh(.38, 400, 4500, 0, 0), .5)
    # 8 · "Quase um mês" + calendário girando para dentro
    add(9.4, pop(700, 300, .08), .35)
    add(9.56, pop(820, 320, .08), .35)
    add(9.7, whoosh(.3, 500, 2500, -.3, .3), .3)
    add(9.84, pop(520, 170, .16), .5)
    add(10.05, tick(1600, .04), .25)
    add(10.6, whoosh(.38, 3500, 400, 0, 0, pico=.3), .4)
    # 9 · cartão "Procurou você": busca, "Não achou." (baque grave) e o cliente indo embora
    add(10.96, whoosh(.36, 300, 2800, -.6, 0), .4)
    add(11.08, pop(1000, 380, .1), .4)
    for k in range(2):
        add(11.18 + k * .09, tick(2100 + 200 * k, .03), .2)
    add(11.6, pop(420, 130, .2), .55)
    add(11.78, whoosh(.55, 400, 3000, 0, 1.0), .5)
    add(11.93, whoosh(.3, 2000, 500, 0, .3, pico=.3), .32)
    # 10 · pílula "−1 cliente por mês": tom descendo
    add(12.18, bolha(160, 640, .24), .38)
    add(12.28, pop(940, 360, .08), .3)
    add(12.32, pop(500, 140, .22), .5)
    add(12.52, pop(700, 300, .08), .3)
    add(12.96, whoosh(.4, 500, 4500, .2, -.8), .5)
    # 11 · etiqueta com a conta: tiques de calculadora e um sino grave no resultado
    add(13.28, whoosh(.42, 300, 3000, -.7, .3), .45)
    for k in range(4):
        add(13.32 + k * .07, tick(1700 + 180 * k, .03), .22)
    add(13.6, sino(587.33, 1.0), .3)
    add(13.6, pop(480, 150, .2), .4)
    add(14.3, subida(.36, 500, 4500), .45)
    # 12 · "Você não precisa" + troca "trabalhar mais." → "dormir menos."
    for k in range(3):
        add(14.65 + k * .12, pop(620 + 110 * k, 280, .08), .32)
    add(15.5, pop(980, 420, .1), .35)
    add(16.32, whoosh(.32, 600, 3200, 0, 0, pico=.4), .42)
    add(16.98, whoosh(.32, 2400, 500, 0, 0, pico=.3), .3)
    # 12b · "Precisa de tempo de volta." (alívio: cintilado) e saída para a esquerda
    add(17.25, whoosh(.4, 300, 2600, .7, 0), .42)
    for k in range(2):
        add(17.3 + k * .12, pop(700 + 110 * k, 300, .08), .3)
    add(17.56, brilho(1.0, 1046.5, (0, 4, 7, 12, 16), .06), .22)
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
    add(23.4, sino(1567.98, 1.2), .16)
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
    gravacao, saida = sys.argv[1], sys.argv[2]
    n = int(DUR * SR) + SR // 2
    voz = dublagem(gravacao)[:n]
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
