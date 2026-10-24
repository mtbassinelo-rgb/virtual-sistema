-- =====================================================================
-- Migração 0106: QR Code do WhatsApp não some enquanto espera ser escaneado
--
-- Enquanto o QR está na tela, o servidor de WhatsApp informa o estado
-- "connecting". O sistema tratava isso como fim da espera e apagava o QR.
-- Agora "conectando" não tira uma conexão de "aguardando QR".
-- Também desativa conexões repetidas (mesmo nome, nunca conectadas, sem mensagens),
-- criadas quando o botão foi apertado várias vezes; fica a mais antiga.
-- =====================================================================
create or replace function app.whatsapp_estado(p_instancia text, p_estado text, p_numero text default null, p_qr text default null) returns void
language sql security definer set search_path = app, pg_temp as $$
  update app.whatsapp_conexoes w
     set estado = x.novo,
         numero = coalesce(case when regexp_replace(coalesce(p_numero, ''), '\D', '', 'g') ~ '^[0-9]{8,15}$'
                                then regexp_replace(p_numero, '\D', '', 'g') end, w.numero),
         qr = case when x.novo = 'aguardando_qr' then coalesce(p_qr, w.qr) end,
         qr_em = case when x.novo = 'aguardando_qr' and p_qr is not null then now() when x.novo = 'aguardando_qr' then w.qr_em end,
         conectado_em = case when x.novo = 'conectado' and w.estado <> 'conectado' then now() else w.conectado_em end,
         atualizado_em = now()
    from (select case when p_estado = 'conectando' and estado = 'aguardando_qr' then 'aguardando_qr' else p_estado end as novo, id
            from app.whatsapp_conexoes where instancia = p_instancia) x
   where w.id = x.id
     and p_estado in ('desconectado','aguardando_qr','conectando','conectado')
$$;

update app.whatsapp_conexoes w set ativo = false, atualizado_em = now()
 where w.ativo and w.estado <> 'conectado'
   and not exists (select 1 from app.whatsapp_mensagens m where m.conexao_id = w.id)
   and exists (select 1 from app.whatsapp_conexoes o
                where o.ativo and o.id <> w.id and lower(trim(o.nome)) = lower(trim(w.nome))
                  and (o.estado = 'conectado' or o.criado_em < w.criado_em));
