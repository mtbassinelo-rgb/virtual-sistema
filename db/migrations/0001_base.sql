-- =====================================================================
-- Virtual Cosméticos · Sistema comercial
-- Migração 0001: estrutura base (CRM, pedidos, pagamentos, Bling, auditoria)
--
-- Princípios:
--   * O Bling é a fonte oficial dos pedidos: a cópia lida do Bling fica em
--     app.bling_pedidos e só a rotina de sincronização escreve nela.
--   * Dados do CRM (vendedora, status comercial, vencimento, previsão de envio,
--     observações) ficam em app.pedidos e nunca alteram a cópia do Bling.
--   * Pagamento só conta como recebido depois de CONFERIDO pelo gerente ou dono,
--     com o número do pedido no Bling. Comprovante enviado não é pagamento.
--   * Toda alteração gera auditoria; a auditoria não pode ser alterada nem apagada.
--   * Permissões ficam no banco (Row Level Security), não só na tela.
-- =====================================================================

create schema if not exists app;

-- ---------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------
create type app.perfil as enum ('dono','gerente','vendedora','consulta');
create type app.pais as enum ('PY','BR');
create type app.moeda as enum ('GS','BRL');
create type app.origem_pedido as enum ('bling','planilha','portal','manual');
create type app.status_comercial as enum ('em_separacao','enviado','entregue','cancelado');
create type app.status_conferencia as enum ('pendente','conferido','recusado');
create type app.modalidade_pagamento as enum
  ('transferencia','efetivo','pix','cartao','link_pagamento','deposito','repasse_marketplace','outro');
create type app.tipo_atendimento as enum ('whatsapp','ligacao','visita','reclamacao','observacao');

-- ---------------------------------------------------------------------
-- Cadastros
-- ---------------------------------------------------------------------
create table app.vendedoras (
  id               uuid primary key default gen_random_uuid(),
  nome             text not null,
  pais             app.pais not null,
  moeda            app.moeda not null,
  whatsapp         text,                       -- número próprio de cada vendedora
  bling_vendedor_id bigint unique,             -- vínculo com o vendedor no Bling
  ativo            boolean not null default true,
  criado_em        timestamptz not null default now()
);

create table app.usuarios (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null,
  email         text not null unique,
  senha_hash    text,                          -- preenchido pela aplicação (argon2)
  perfil        app.perfil not null,
  vendedora_id  uuid references app.vendedoras(id),
  ativo         boolean not null default true,
  criado_em     timestamptz not null default now(),
  constraint vendedora_tem_vinculo check (perfil <> 'vendedora' or vendedora_id is not null)
);

create table app.canais (
  codigo  text primary key,                     -- direto, portal, shopee, mercado_livre, tiktok, outro
  nome    text not null,
  marketplace boolean not null default false,
  bling_loja_id bigint unique                   -- loja correspondente no Bling, quando houver
);
insert into app.canais (codigo, nome, marketplace) values
  ('direto','Venda direta (vendedora)', false),
  ('portal','Área do cliente', false),
  ('shopee','Shopee', true),
  ('mercado_livre','Mercado Livre', true),
  ('tiktok','TikTok Shop', true),
  ('outro','Outro', false);

create table app.clientes (
  id                uuid primary key default gen_random_uuid(),
  nome              text not null,
  telefone          text,
  whatsapp          text,
  cidade            text,
  departamento      text,                     -- departamento (PY) ou estado (BR)
  tipo_cliente      text,
  perfil_comercial  text,                     -- salão, profissional, loja, revendedor...
  vendedora_id      uuid not null references app.vendedoras(id),
  preferencias      text,
  observacoes       text,
  bling_contato_id  bigint unique,
  mesclado_em       uuid references app.clientes(id),   -- quando dois cadastros eram a mesma pessoa
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now()
);
create index on app.clientes (vendedora_id);

-- Nomes como aparecem nas planilhas das vendedoras, para importar sem duplicar
create table app.cliente_nomes_planilha (
  vendedora_id  uuid not null references app.vendedoras(id),
  nome_normal   text not null,
  cliente_id    uuid not null references app.clientes(id),
  primary key (vendedora_id, nome_normal)
);

-- ---------------------------------------------------------------------
-- Cópia somente leitura dos pedidos do Bling
-- ---------------------------------------------------------------------
create table app.bling_pedidos (
  bling_id          bigint primary key,
  numero            bigint,
  numero_loja       text,                      -- nº do pedido no marketplace
  loja_id           bigint,
  data              date,
  data_prevista     date,
  contato_bling_id  bigint,
  contato_nome      text,
  vendedor_bling_id bigint,
  situacao_id       bigint,
  situacao_nome     text,
  total             numeric(14,2),
  total_produtos    numeric(14,2),
  itens             jsonb not null default '[]',
  payload           jsonb not null,            -- resposta original do Bling, sem alteração
  conteudo_hash     text not null,
  sincronizado_em   timestamptz not null default now(),
  mudou_em          timestamptz not null default now()
);
create unique index on app.bling_pedidos (numero) where numero is not null;

-- ---------------------------------------------------------------------
-- Pedidos (dados do CRM)
-- ---------------------------------------------------------------------
create table app.pedidos (
  id                    uuid primary key default gen_random_uuid(),
  origem                app.origem_pedido not null,
  bling_id              bigint unique references app.bling_pedidos(bling_id),
  bling_numero          bigint,               -- nº do pedido no Bling (informado ou sincronizado)
  canal                 text not null default 'direto' references app.canais(codigo),
  numero_externo        text,                 -- nº no marketplace
  cliente_id            uuid references app.clientes(id),
  vendedora_id          uuid not null references app.vendedoras(id),
  data_pedido           date not null,
  moeda                 app.moeda not null,
  valor_total           numeric(14,2) not null check (valor_total >= 0),
  status_comercial      app.status_comercial not null default 'em_separacao',
  previsao_envio        date,
  enviado_em            date,
  entregue_em           date,
  vencimento            date,
  credito_concedido     boolean not null default false,
  taxa_marketplace      numeric(14,2),
  repasse_previsto      numeric(14,2),
  observacoes           text,
  bling_hash_conferido  text,                 -- versão do Bling que alguém já revisou
  criado_por            uuid references app.usuarios(id),
  criado_em             timestamptz not null default now(),
  atualizado_em         timestamptz not null default now(),
  constraint bling_tem_id check (origem <> 'bling' or bling_id is not null),
  constraint credito_tem_vencimento check (not credito_concedido or vencimento is not null)
);
create unique index on app.pedidos (bling_numero) where bling_numero is not null;
create unique index on app.pedidos (canal, numero_externo) where numero_externo is not null;
create index on app.pedidos (vendedora_id, data_pedido);
create index on app.pedidos (cliente_id);

-- Vendas lidas das planilhas das vendedoras (importação idempotente)
create table app.planilha_vendas (
  id            uuid primary key default gen_random_uuid(),
  vendedora_id  uuid not null references app.vendedoras(id),
  planilha_id   text not null,
  aba           text not null,
  linha         int  not null,
  data          date not null,
  nome_cliente  text not null,
  valor         numeric(14,2) not null,
  valor_credito numeric(14,2) not null default 0,
  forma         text,
  terceiro      text,
  confirmado    boolean,
  marcado_bling text,
  pedido_id     uuid references app.pedidos(id),
  importado_em  timestamptz not null default now(),
  unique (planilha_id, aba, linha)
);

-- ---------------------------------------------------------------------
-- Pagamentos, comprovantes e conferência
-- ---------------------------------------------------------------------
create table app.pagamentos (
  id                     uuid primary key default gen_random_uuid(),
  pedido_id              uuid not null references app.pedidos(id),
  valor                  numeric(14,2) not null check (valor > 0),
  data                   date not null,
  modalidade             app.modalidade_pagamento not null,
  banco                  text,
  observacao             text,
  registrado_por         uuid references app.usuarios(id),
  registrado_em          timestamptz not null default now(),
  status_conferencia     app.status_conferencia not null default 'pendente',
  conferido_por          uuid references app.usuarios(id),
  conferido_em           timestamptz,
  conferencia_bling_numero bigint,          -- nº do pedido no Bling usado na conferência
  motivo_recusa          text,
  constraint conferido_completo check (
    status_conferencia = 'pendente'
    or (conferido_por is not null and conferido_em is not null)),
  constraint conferido_tem_bling check (
    status_conferencia <> 'conferido' or conferencia_bling_numero is not null),
  constraint recusa_tem_motivo check (
    status_conferencia <> 'recusado' or coalesce(motivo_recusa,'') <> '')
);
create index on app.pagamentos (pedido_id);

create table app.comprovantes (
  id             uuid primary key default gen_random_uuid(),
  pagamento_id   uuid not null references app.pagamentos(id),
  arquivo        text not null,               -- caminho no armazenamento do servidor
  nome_original  text,
  mime           text,
  tamanho        bigint,
  sha256         text not null,
  enviado_por    uuid references app.usuarios(id),
  enviado_em     timestamptz not null default now(),
  unique (pagamento_id, sha256)
);

-- ---------------------------------------------------------------------
-- Relacionamento
-- ---------------------------------------------------------------------
create table app.atendimentos (
  id          uuid primary key default gen_random_uuid(),
  cliente_id  uuid not null references app.clientes(id),
  pedido_id   uuid references app.pedidos(id),
  tipo        app.tipo_atendimento not null,
  resultado   text,
  nota        text,
  usuario_id  uuid references app.usuarios(id),
  em          timestamptz not null default now()
);
create index on app.atendimentos (cliente_id, em desc);
alter table app.pedidos add column atendimento_id uuid references app.atendimentos(id);

create table app.tarefas (
  id          uuid primary key default gen_random_uuid(),
  cliente_id  uuid references app.clientes(id),
  pedido_id   uuid references app.pedidos(id),
  titulo      text not null,
  vence_em    date,
  feita       boolean not null default false,
  responsavel uuid references app.usuarios(id),
  criado_em   timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Integrações: execuções de sincronização e propostas de escrita (futuro)
-- ---------------------------------------------------------------------
create table app.sincronizacoes (
  id          bigserial primary key,
  fonte       text not null,                  -- bling, planilhas, shopee...
  inicio      timestamptz not null default now(),
  fim         timestamptz,
  status      text not null default 'rodando',
  lidos       int not null default 0,
  criados     int not null default 0,
  atualizados int not null default 0,
  erros       jsonb not null default '[]'
);

-- Toda escrita em sistema externo (Bling, marketplaces) passa por aqui:
-- proposta -> aprovação do dono -> execução única -> resultado registrado.
create table app.escritas_externas (
  id             uuid primary key default gen_random_uuid(),
  sistema        text not null,               -- bling, shopee...
  operacao       text not null,               -- ex.: criar_pedido, atualizar_situacao
  alvo           text,
  dados          jsonb not null,
  status         text not null default 'proposta'
                 check (status in ('proposta','aprovada','recusada','executada','falhou')),
  solicitado_por uuid references app.usuarios(id),
  solicitado_em  timestamptz not null default now(),
  aprovado_por   uuid references app.usuarios(id),
  aprovado_em    timestamptz,
  executado_em   timestamptz,
  resultado      jsonb
);

-- ---------------------------------------------------------------------
-- Integrações futuras (área reservada)
-- ---------------------------------------------------------------------
create table app.integracoes (
  codigo     text primary key,
  nome       text not null,
  situacao   text not null default 'planejada' check (situacao in ('ativa','planejada','pausada')),
  modo       text not null default 'leitura' check (modo in ('leitura','leitura_e_escrita')),
  observacao text
);
insert into app.integracoes (codigo, nome, situacao, observacao) values
  ('planilhas','Planilhas das vendedoras (Google Sheets)','ativa','Importação das vendas atuais'),
  ('bling','Bling','planejada','Fonte oficial de pedidos e estoque'),
  ('whatsapp','WhatsApp Business (API oficial)','planejada','Hoje: link com mensagem pronta'),
  ('shopee','Shopee','planejada','Verificar se os pedidos já entram pelo Bling'),
  ('mercado_livre','Mercado Livre','planejada','Verificar se os pedidos já entram pelo Bling'),
  ('tiktok','TikTok Shop','planejada',null),
  ('otimizacao','API de otimização','planejada','A definir: preço, estoque ou anúncios');
