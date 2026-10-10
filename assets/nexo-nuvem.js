/* NEXO · ligação dos controles internos com a nuvem.
   Os dados ficam em um banco (Supabase) e só são lidos ou gravados com o código de acesso.
   O código nunca fica neste arquivo: ele chega pelo link de acesso (#k=...) ou é digitado
   uma vez em cada aparelho, e fica guardado no navegador daquele aparelho. */
(function () {
  "use strict";
  var BANCO = "https://osewfvfvazpktoeeqihj.supabase.co";
  var CHAVE_API = "sb_publishable_xTVSL26eUFcdx3EVOyPJow_L4iC_iBf";
  var GUARDA = "nexo.acesso";

  function doLink() {
    var m = /[#&]k=([A-Za-z0-9_-]{8,80})/.exec(String(location.hash || ""));
    return m ? m[1] : "";
  }
  var codigo = doLink();
  if (codigo) { try { localStorage.setItem(GUARDA, codigo); } catch (e) {} }
  else { try { codigo = localStorage.getItem(GUARDA) || ""; } catch (e) { codigo = ""; } }

  function chamar(funcao, corpo, cod) {
    corpo.p_codigo = cod == null ? codigo : cod;
    var ctl = typeof AbortController === "function" ? new AbortController() : null;
    var t = ctl ? setTimeout(function () { ctl.abort(); }, 20000) : null;
    return fetch(BANCO + "/rest/v1/rpc/" + funcao, {
      method: "POST",
      headers: { "Content-Type": "application/json", "apikey": CHAVE_API },
      body: JSON.stringify(corpo),
      signal: ctl ? ctl.signal : undefined
    }).then(function (r) {
      clearTimeout(t);
      if (!r.ok) throw { code: "rede", status: r.status };
      return r.json();
    }, function () { clearTimeout(t); throw { code: "rede" }; }).then(function (j) {
      if (!j || typeof j !== "object") throw { code: "rede" };
      if (j.erro) throw { code: j.erro };
      return j;
    });
  }

  /* janela simples, com as cores da marca, usada para digitar o código e para mostrar o link */
  function janela(titulo, texto, valor, rotuloBotao, aoConfirmar, soLeitura) {
    var fundo = document.createElement("div");
    fundo.setAttribute("role", "dialog"); fundo.setAttribute("aria-modal", "true"); fundo.setAttribute("aria-label", titulo);
    fundo.style.cssText = "position:fixed;inset:0;z-index:999;background:rgba(31,9,11,.55);display:flex;align-items:flex-start;justify-content:center;padding:calc(48px + env(safe-area-inset-top,0px)) 16px 16px;overflow:auto";
    var caixa = document.createElement("form");
    caixa.style.cssText = "background:#F4EEE8;color:#3A181D;border:1px solid #D5C9C7;border-radius:18px;width:min(460px,100%);padding:24px;font:400 15px/1.5 'Work Sans',Arial,sans-serif";
    var h = document.createElement("div"); h.textContent = titulo;
    h.style.cssText = "font:700 24px/1.2 'Playfair Display',Georgia,serif;color:#1F090B";
    var p = document.createElement("p"); p.textContent = texto; p.style.cssText = "margin:10px 0 14px";
    var campo = document.createElement("input");
    campo.type = "text"; campo.value = valor || ""; campo.readOnly = !!soLeitura; campo.id = "nexo-nuvem-campo";
    campo.setAttribute("aria-label", titulo); campo.autocomplete = "off"; campo.spellcheck = false;
    campo.setAttribute("autocapitalize", "off");
    campo.style.cssText = "width:100%;box-sizing:border-box;font:400 16px/1.4 'Work Sans',Arial,sans-serif;padding:11px 12px;border:1px solid #D5C9C7;border-radius:10px;background:#FBF8F5;color:#1F090B";
    var aviso = document.createElement("div"); aviso.setAttribute("role", "status");
    aviso.style.cssText = "min-height:20px;margin-top:8px;font-size:13.5px;font-weight:500;color:#1F090B";
    var fim = document.createElement("div"); fim.style.cssText = "display:flex;justify-content:flex-end;gap:10px;margin-top:10px;flex-wrap:wrap";
    function botao(txt, cheio) {
      var b = document.createElement("button"); b.textContent = txt; b.type = cheio ? "submit" : "button";
      b.style.cssText = "appearance:none;cursor:pointer;border-radius:999px;padding:10px 20px;font:600 14px/1.2 'Work Sans',Arial,sans-serif;" +
        (cheio ? "border:0;background:#C6A16A;color:#1F090B" : "border:1px solid #D5C9C7;background:transparent;color:#1F090B");
      return b;
    }
    var sair = botao("Fechar", false), ok = botao(rotuloBotao, true);
    function fechar() { if (fundo.parentNode) fundo.parentNode.removeChild(fundo); document.removeEventListener("keydown", tecla); }
    function tecla(ev) { if (ev.key === "Escape") fechar(); }
    sair.addEventListener("click", fechar);
    fundo.addEventListener("mousedown", function (ev) { if (ev.target === fundo) fechar(); });
    caixa.addEventListener("submit", function (ev) {
      ev.preventDefault();
      aoConfirmar(campo, function (msg) { aviso.textContent = msg || ""; }, fechar, ok);
    });
    fim.appendChild(sair); fim.appendChild(ok);
    caixa.appendChild(h); caixa.appendChild(p); caixa.appendChild(campo); caixa.appendChild(aviso); caixa.appendChild(fim);
    fundo.appendChild(caixa); document.body.appendChild(fundo);
    document.addEventListener("keydown", tecla);
    campo.focus(); if (soLeitura) campo.select();
  }

  window.NexoNuvem = {
    /* true quando este aparelho já tem o código de acesso */
    ativo: function () { return !!codigo; },
    /* registros de um controle: [{ id, dados, versao, atualizado_em }].
       A lista traz também `excluidos`: os ids que já foram excluídos em algum aparelho. */
    listar: function (app) {
      return chamar("nexo_listar", { p_app: app }).then(function (j) {
        var lista = Array.isArray(j.registros) ? j.registros : [];
        lista.excluidos = Array.isArray(j.excluidos) ? j.excluidos : [];
        return lista;
      });
    },
    /* grava um registro. Com `versao`, só grava se ninguém mudou o registro depois dessa versão;
       se mudou, devolve { conflito: true, versao, dados } com o que está na nuvem. */
    gravar: function (app, id, dados, versao) {
      return chamar("nexo_gravar", { p_app: app, p_id: id, p_dados: dados, p_versao: versao == null ? null : versao });
    },
    excluir: function (app, id) { return chamar("nexo_excluir", { p_app: app, p_id: id }); },
    /* endereço desta página já com o código: abrir em outro aparelho liga aquele aparelho */
    link: function () { return location.origin + location.pathname + "#k=" + codigo; },
    /* pede o código de acesso; resolve true quando o código confere e fica guardado */
    pedir: function () {
      return new Promise(function (resolve) {
        janela("Código de acesso", "Digite o código de acesso do NEXO para este aparelho passar a mostrar e salvar os dados da nuvem.", "", "Ligar este aparelho",
          function (campo, avisar, fechar, ok) {
            var c = String(campo.value || "").trim().replace(/^.*[#&]k=/, "");
            if (!/^[A-Za-z0-9_-]{8,80}$/.test(c)) { avisar("O código tem letras e números, sem espaços."); return; }
            ok.disabled = true; avisar("Conferindo…");
            chamar("nexo_listar", { p_app: "painel" }, c).then(function () {
              codigo = c; try { localStorage.setItem(GUARDA, c); } catch (e) {}
              /* tira do endereço um código antigo, para ele não voltar a valer quando a página recarregar */
              try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
              fechar(); resolve(true);
            }, function (e) {
              ok.disabled = false;
              avisar(e && e.code === "codigo" ? "Este código não confere." : "Não foi possível conferir agora. Verifique a internet e tente de novo.");
            });
          }, false);
      });
    },
    /* copia o link de acesso; se o navegador não deixar copiar, mostra o link para copiar à mão */
    copiarLink: function () {
      var link = this.link();
      function mostrar() {
        janela("Link de acesso", "Abra este link em outro aparelho para ele mostrar os mesmos dados. Quem tiver o link consegue ver e alterar tudo.", link, "Copiar",
          function (campo, avisar) {
            campo.select();
            try { navigator.clipboard.writeText(link).then(function () { avisar("Link copiado."); }, function () { avisar("Selecione o link acima e copie."); }); }
            catch (e) { avisar("Selecione o link acima e copie."); }
          }, true);
      }
      mostrar();
    },
    /* tira o código deste aparelho (ele volta a pedir o código) */
    esquecer: function () { codigo = ""; try { localStorage.removeItem(GUARDA); } catch (e) {} }
  };
})();
