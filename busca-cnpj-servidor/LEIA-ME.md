# Busca de Empresas — servidor

Código da Edge Function `busca-cnpj` do Supabase (projeto "isabeladelimaalmeida4-cyber's Project").
O site fica em `busca-cnpj/index.html` e é publicado no Render a partir desta ramificação.

- Senha de acesso: segredo `ACCESS_KEY` nas Edge Functions do Supabase.
- Dados salvos na tabela `public.empresas` (RLS ativo, só a função acessa).
- Fontes: dados abertos do CNPJ (Receita Federal) via Casa dos Dados, BrasilAPI e Minha Receita.
