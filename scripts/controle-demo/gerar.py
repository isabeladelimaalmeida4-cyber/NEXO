#!/usr/bin/env python3
"""Gera atlantica-app/controle/demo/index.html a partir do painel real.
Rodar sempre que mudar atlantica-app/controle/index.html:  python3 scripts/controle-demo/gerar.py"""
import pathlib
raiz = pathlib.Path(__file__).resolve().parents[2]
src = (raiz / 'atlantica-app/controle/index.html').read_text(encoding='utf-8')
mock = (raiz / 'scripts/controle-demo/mock.js').read_text(encoding='utf-8')
def troca(a, b):
    global src
    assert a in src, a
    src = src.replace(a, b)
troca('<script src="../vendor/supabase.js"></script>', '<script>window.CTRL_DEMO=true;</script>\n<script>\n' + mock + '</script>')
troca('href="../icon-192.png"', 'href="../../icon-192.png"')
troca('href="../icon-180.png"', 'href="../../icon-180.png"')
troca('<title>Controle de mensalidades · Atlântica</title>', '<title>Demonstração · Controle de mensalidades · Atlântica</title>')
destino = raiz / 'atlantica-app/controle/demo/index.html'
destino.parent.mkdir(exist_ok=True)
destino.write_text(src, encoding='utf-8')
print('ok', destino, len(src))
