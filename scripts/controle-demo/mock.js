/* Banco de mentira para a demonstração do painel de mensalidades.
   Tudo fica na memória: recarregar a página volta ao início. Datas são calculadas a partir de hoje. */
(function(){
var pad=function(n){return String(n).padStart(2,'0')};
var hoje=new Date();
var mk=function(off){var d=new Date(hoje.getFullYear(),hoje.getMonth()+off,1);return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-01'};
var dia=function(off,d){var x=new Date(hoje.getFullYear(),hoje.getMonth()+off,Math.min(d,28));if(x>hoje)x=new Date(hoje);return x.getFullYear()+'-'+pad(x.getMonth()+1)+'-'+pad(x.getDate())};
var hojeDia=hoje.getDate();

/* nome, telefone, indicado_por, meses desde o início, dia de vencimento próprio, meses NÃO pagos (0 = mês atual, 1 = mês passado...), não cobrar */
var base=[
 ['Ana Paula Ribeiro','(66) 99812-3401','joctan',4,null,[]],
 ['Bruna Carvalho','(66) 99745-1122','joctan',3,null,[0]],
 ['Camila Duarte','(66) 99630-7788','rafael',4,null,[]],
 ['Daniela Moura','(66) 98411-2093','isabela',2,null,[0,1]],
 ['Eliane Santos','(66) 99921-4410','rafael',3,25,[0]],
 ['Fernanda Lopes','(66) 99158-6604','joctan',1,null,[]],
 ['Gabriela Nunes','(66) 98877-3015','isabela',4,null,[]],
 ['Helena Prado','(66) 99204-9981','rafael',2,null,[]],
 ['Isadora Melo','(66) 99673-1457',null,3,null,[0]],
 ['Juliana Teixeira','(66) 98102-7730','joctan',2,25,[0]],
 ['Karen Oliveira','(66) 99540-2286','rafael',1,null,[0]],
 ['Larissa Pires','(66) 99317-6649','isabela',3,null,[]],
 ['Marta Rocha','(66) 98266-1038',null,4,null,[0,1,2]],
 ['Natália Freitas','(66) 99488-5521','joctan',0,null,[]],
 ['Patrícia Gomes (sócia de teste)','(66) 99000-0000',null,4,null,[],true]
];
var formas=['Pix','Pix','Pix','Dinheiro','Cartão','Transferência'];
var db={ctrl_clientes:[],ctrl_pagamentos:[],ctrl_ajustes:[{chave:'valor_mensal',valor:49.9},{chave:'dia_vencimento',valor:10},{chave:'comissao_pct',valor:10}]};
var n=1;
base.forEach(function(b,i){
  var id='demo-c'+(i+1);
  db.ctrl_clientes.push({id:id,app_user_id:i<12?'demo-u'+(i+1):null,nome:b[0],usuario:i<12?b[0].normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z]/g,''):null,telefone:b[1],indicado_por:b[2],valor_mensal:i===6?59.9:null,dia_vencimento:b[4],comissao_pct:b[2]==='rafael'&&i===2?15:null,inicio:mk(-b[3]),cobrar:!b[6],app_ativo:true,obs:null});
  if(b[6])return;
  for(var off=-b[3];off<=0;off++){
    if(b[5].indexOf(-off)>=0)continue;
    var dv=b[4]||10;
    if(off===0&&hojeDia<dv-2&&i%2)continue;
    var valor=i===6?59.9:49.9;
    var pct=b[2]?(b[2]==='rafael'&&i===2?15:10):null;
    var antigo=off<=-1;
    db.ctrl_pagamentos.push({id:'demo-p'+(n++),cliente_id:id,competencia:mk(off),valor:valor,pago_em:dia(off,dv-((i+off+9)%5)),forma:formas[(i+off+6)%formas.length],
      indicador:b[2],comissao_pct:pct,comissao_valor:pct?Math.round(valor*pct)/100:null,
      repasse_feito:!!(b[2]&&antigo&&!(off===-1&&i%3===0)),repasse_em:b[2]&&antigo?dia(off+1,5):null,repasse_por:b[2]&&antigo?['Isabela','Joctãn','Rafael'][i%3]:null,
      registrado_por:['Isabela','Joctãn','Rafael'][(i+off+3)%3],obs:null,criado_em:new Date().toISOString()});
  }
});
db.ctrl_pagamentos.forEach(function(p){if(!p.repasse_feito){p.repasse_em=null;p.repasse_por=null}});

var sess={demo:true};
function q(t){var op='select',payload=null,filters=[];var o={
  select:function(){return o},order:function(){return o},
  insert:function(r){op='insert';payload=r;return o},update:function(r){op='update';payload=r;return o},
  delete:function(){op='delete';return o},upsert:function(r){op='upsert';payload=r;return o},
  eq:function(k,v){filters.push(function(x){return x[k]===v});return o},
  in:function(k,v){filters.push(function(x){return v.indexOf(x[k])>=0});return o},
  then:function(res,rej){try{res(run())}catch(e){rej(e)}}};
  function run(){var T=db[t];var m=function(x){return filters.every(function(f){return f(x)})};
    if(op==='select')return{data:JSON.parse(JSON.stringify(T)),error:null};
    if(op==='insert'){var rows=[].concat(payload);for(var i=0;i<rows.length;i++){var r=rows[i];
      if(t==='ctrl_pagamentos'&&T.some(function(x){return x.cliente_id===r.cliente_id&&x.competencia===r.competencia}))return{data:null,error:{message:'duplicate key value'}};
      T.push(Object.assign({id:'demo-n'+(n++),repasse_feito:false,cobrar:true,app_user_id:null},r))}return{data:null,error:null}}
    if(op==='update'){T.filter(m).forEach(function(x){Object.assign(x,payload)});return{data:null,error:null}}
    if(op==='delete'){if(t==='ctrl_clientes'){var ids=T.filter(m).map(function(x){return x.id});db.ctrl_pagamentos=db.ctrl_pagamentos.filter(function(p){return ids.indexOf(p.cliente_id)<0})}
      db[t]=T.filter(function(x){return !m(x)});return{data:null,error:null}}
    if(op==='upsert'){payload.forEach(function(r){var e=T.find(function(x){return x.chave===r.chave});e?Object.assign(e,r):T.push(r)});return{data:null,error:null}}
  }
  return o;
}
window.supabase={createClient:function(){return{
  from:q,
  rpc:function(f){return Promise.resolve(f==='ctrl_eh_admin'?{data:true,error:null}:{data:0,error:null})},
  auth:{
    getSession:function(){return Promise.resolve({data:{session:sess}})},
    signInWithPassword:function(){sess={demo:true};return Promise.resolve({error:null})},
    signOut:function(){sess=null;return Promise.resolve({error:null})},
    updateUser:function(){return Promise.resolve({error:null})},
    onAuthStateChange:function(){}
  }}}};
})();
