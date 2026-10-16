-- "Quero ser cliente": cadastro feito pelo próprio interessado no site. Vira atendimento da equipe.
create table app.cadastros_site (
  id           uuid primary key default gen_random_uuid(),
  nome         text not null check (length(nome) between 2 and 120),      -- salão / empresa
  contato      text check (length(contato) <= 120),                        -- pessoa
  whatsapp     text not null check (whatsapp ~ '^[0-9]{8,15}$'),
  email        text check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(email) <= 160),
  cidade       text check (length(cidade) <= 120),
  tipo         text check (tipo in ('salao','perfumaria','revenda','farmacia','loja','outro')),
  documento    text check (length(documento) <= 30),
  mensagem     text check (length(mensagem) <= 1000),
  idioma       text not null default 'pt' check (idioma in ('pt','es')),
  criado_em    timestamptz not null default now(),
  atendido_em  timestamptz,
  atendido_por uuid references app.usuarios(id)
);
create index on app.cadastros_site (criado_em desc);
alter table app.cadastros_site enable row level security;
create policy ler on app.cadastros_site for select using (app.uid() is not null and app.perfil_atual() <> 'consulta');
create policy atender on app.cadastros_site for update using (app.pode_escrever()) with check (app.pode_escrever());
grant select, update (atendido_em, atendido_por) on app.cadastros_site to vc_app;
create trigger auditar after insert or update or delete on app.cadastros_site for each row execute function app.auditar('id');

create or replace function app.registrar_cadastro_site(p_nome text, p_contato text, p_whatsapp text, p_email text, p_cidade text,
                                                       p_tipo text, p_documento text, p_mensagem text, p_idioma text)
returns text language plpgsql security definer set search_path = app, pg_temp as $$
declare v_zap text := regexp_replace(coalesce(p_whatsapp,''), '\D', '', 'g'); v_email text := nullif(lower(trim(coalesce(p_email,''))), '');
begin
  if (select count(*) from app.cadastros_site where criado_em > now() - interval '1 hour') >= 60 then
    raise exception 'Muitos cadastros agora. Fale direto pelo WhatsApp.';
  end if;
  if exists (select 1 from app.cadastros_site where whatsapp = v_zap and criado_em > now() - interval '1 day') then
    raise exception 'Recebemos o seu cadastro hoje. Continue a conversa pelo WhatsApp.';
  end if;
  if length(trim(coalesce(p_nome,''))) < 2 then raise exception 'Informe o nome do salão ou da empresa.'; end if;
  if length(v_zap) < 8 then raise exception 'Informe um WhatsApp válido, com DDD.'; end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'E-mail inválido.'; end if;
  insert into app.cadastros_site (nome, contato, whatsapp, email, cidade, tipo, documento, mensagem, idioma)
  values (left(trim(p_nome),120), nullif(left(trim(coalesce(p_contato,'')),120),''), v_zap, v_email,
          nullif(left(trim(coalesce(p_cidade,'')),120),''),
          case when p_tipo in ('salao','perfumaria','revenda','farmacia','loja','outro') then p_tipo end,
          nullif(left(trim(coalesce(p_documento,'')),30),''), nullif(left(trim(coalesce(p_mensagem,'')),1000),''),
          case when p_idioma = 'es' then 'es' else 'pt' end);
  return app.whatsapp_empresa(case when p_idioma = 'es' then 'GS'::app.moeda else 'BRL'::app.moeda end);
end $$;
grant execute on function app.registrar_cadastro_site(text, text, text, text, text, text, text, text, text) to vc_app;
