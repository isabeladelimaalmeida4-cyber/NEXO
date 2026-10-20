"""Gera a narração do vídeo (video/narracao.m4a), cada fala começando junto da legenda.

Voz: Piper pt_BR "cadu" (dados CC0), rodando local pelo sherpa-onnx.
  pip install sherpa-onnx soundfile numpy
  curl -L https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-pt_BR-cadu-medium.tar.bz2 | tar xj
  python3 narrar.py cadu-medium narracao.wav
  ffmpeg -i narracao.wav -af "highpass=f=70,acompressor=threshold=-20dB:ratio=3:attack=5:release=120,loudnorm=I=-16:TP=-1.5:LRA=7" -ar 44100 -c:a aac -b:a 128k ../narracao.m4a
Os tempos de FALAS estão em tempo de animação; TRECHOS precisa bater com o de nexo-video.js.
"""
import sys, json, numpy as np, sherpa_onnx, soundfile as sf
voz = sys.argv[1]; out = sys.argv[2]
d = f"{sys.path[0]}/vits-piper-pt_BR-{voz}"
tts = sherpa_onnx.OfflineTts(sherpa_onnx.OfflineTtsConfig(model=sherpa_onnx.OfflineTtsModelConfig(
    vits=sherpa_onnx.OfflineTtsVitsModelConfig(model=f"{d}/pt_BR-{voz}.onnx", tokens=f"{d}/tokens.txt", data_dir=f"{d}/espeak-ng-data"),
    num_threads=4)))
# (início em s, fim máximo em s, texto) — cada fala começa quando a legenda correspondente aparece
FALAS = [
  (0.05, 1.30, "Deixa eu adivinhar..."),
  (2.62, 3.80, "Seu negócio é melhor..."),
  (3.85, 5.65, "do que o seu site mostra hoje."),
  (5.66, 6.95, "Seu site está desatualizado."),
  (7.0, 8.32, "E a planilha ainda é atualizada à mão."),
  (8.42, 9.40, "Quero meu site!"),
  (9.40, 11.00, "Boas vindas ao Nexo."),  # sem hífen a voz pronuncia melhor
  (11.08, 12.20, "Criação de sites."),
  (12.22, 13.34, "Automatizar a rotina."),
  (13.32, 14.62, "Planilhas e agenda em ordem!"),
  (14.55, 16.40, "Um site feito sob medida..."),
  (16.42, 17.28, "com método."),
  (17.30, 18.72, "à altura do seu negócio."),
  (19.60, 21.90, "Nexo, operações que transformam."),
  (23.35, 24.90, "Quero meu site."),
]
# mesmos trechos desacelerados do nexo-video.js (início, fim, fator) em tempo de animação
TRECHOS = [(5.6, 8.32, 1.6), (10.98, 14.64, 1.25)]
def video(t):
    atraso = 0
    for a, b, f in TRECHOS:
        if t < a: break
        if t < b: return t + atraso + (t - a) * (f - 1)
        atraso += (b - a) * (f - 1)
    return t + atraso
DUR = video(25.0)
FALAS = [(video(a), video(b), x) for a, b, x in FALAS]
SR = tts.sample_rate; total = np.zeros(int(DUR * SR), dtype=np.float32); rel = []
for ini, fim, txt in FALAS:
    vel = 1.0
    while True:
        a = tts.generate(txt, sid=0, speed=vel); s = np.array(a.samples, dtype=np.float32)
        nz = np.where(np.abs(s) > 0.01)[0]; s = s[max(0, nz[0] - 200): nz[-1] + 1500]  # corta silêncios das pontas
        dur = len(s) / SR
        if ini + dur <= fim + 0.02 or vel >= 1.08: break
        vel = round(vel * min(1.15, (dur / (fim - ini)) * 1.02), 3)
    i = int(ini * SR); s = s[: len(total) - i]; total[i:i + len(s)] += s
    rel.append(('OK' if ini+dur<=fim+.02 else 'PASSA', ini, round(ini + dur, 2), fim, vel, txt))
pico = np.max(np.abs(total)); total = total / pico * 0.89
sf.write(out, total, SR)
for r in rel: print(r)
