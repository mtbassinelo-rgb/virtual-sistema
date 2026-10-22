-- Mensagem que o cliente vê ao abrir a loja, editável pela equipe (Site → Mensagem ao cliente).
-- Cada cliente vê uma vez; ao salvar com "mostrar de novo", todos veem a mensagem nova na próxima vez que abrirem.
create table app.mensagem_cliente (
  id        int primary key default 1 check (id = 1),
  ativo     boolean not null default true,
  titulo_pt text not null, texto_pt text not null, botao_pt text not null,
  titulo_es text not null, texto_es text not null, botao_es text not null,
  versao    int not null default 1,
  atualizado_por uuid references app.usuarios(id),
  atualizado_em  timestamptz not null default now()
);
alter table app.mensagem_cliente enable row level security;
create policy ler on app.mensagem_cliente for select using (app.uid() is not null);
grant select on app.mensagem_cliente to vc_app;

insert into app.mensagem_cliente (titulo_pt, texto_pt, botao_pt, titulo_es, texto_es, botao_es) values (
  'Bem-vindo(a), {nome}!',
  E'Obrigado por ser cliente da **Virtual Cosméticos**. A partir de agora você pode fazer seus pedidos direto pelo nosso site.\n- **Comprar pelo site é mais rápido e seguro:** você vê seus preços, as promoções e as novidades atualizadas, monta o pedido quando quiser e acompanha cada etapa até a entrega.\n- Seu pedido chega **direto para a sua vendedora {vendedora}**, sem erro de anotação.\n- Se algum produto do seu pedido **não estiver disponível**, a sua vendedora entra em contato para avisar e fechar o pedido com você.\n**Boas compras! 🛍️**',
  'Começar a comprar',
  '¡Bienvenido/a, {nombre}!',
  E'Gracias por ser cliente de **Virtual Cosméticos**. Desde ahora usted puede hacer sus pedidos directamente por nuestro sitio.\n- **Comprar por el sitio es más rápido y seguro:** ve sus precios, las promociones y las novedades actualizadas, arma el pedido cuando quiera y sigue cada etapa hasta la entrega.\n- Su pedido llega **directo a su vendedora {vendedora}**, sin errores de anotación.\n- Si algún producto de su pedido **no está disponible**, su vendedora se comunicará con usted para avisarle y cerrar juntos el pedido.\n**¡Buenas compras! 🛍️**',
  'Empezar a comprar');

alter table app.clientes add column mensagem_versao_vista int not null default 0;
update app.clientes set mensagem_versao_vista = 1 where boas_vindas_em is not null;

create or replace function app.portal_mensagem(p_sessao_hash text)
returns table (titulo_pt text, texto_pt text, botao_pt text, titulo_es text, texto_es text, botao_es text)
language sql stable security definer set search_path = app, pg_temp as $$
  select m.titulo_pt, m.texto_pt, m.botao_pt, m.titulo_es, m.texto_es, m.botao_es
    from app.mensagem_cliente m join app.clientes c on c.id = app.portal_cliente_id(p_sessao_hash)
   where m.ativo and c.mensagem_versao_vista < m.versao
$$;
create or replace function app.portal_marcar_mensagem(p_sessao_hash text) returns void
language sql security definer set search_path = app, pg_temp as $$
  update app.clientes set mensagem_versao_vista = (select versao from app.mensagem_cliente where id = 1), boas_vindas_em = coalesce(boas_vindas_em, now())
   where id = app.portal_cliente_id(p_sessao_hash)
$$;
create or replace function app.salvar_mensagem_cliente(p_ativo boolean, p_titulo_pt text, p_texto_pt text, p_botao_pt text,
  p_titulo_es text, p_texto_es text, p_botao_es text, p_mostrar_de_novo boolean) returns int
language plpgsql security definer set search_path = app, pg_temp as $$
declare v int;
begin
  if not coalesce(app.pode_gerir(), false) then raise exception 'Só gerente ou dono muda a mensagem dos clientes.' using errcode = 'insufficient_privilege'; end if;
  if length(trim(coalesce(p_texto_pt, ''))) < 3 or length(trim(coalesce(p_texto_es, ''))) < 3 then raise exception 'Escreva a mensagem em português e em espanhol.'; end if;
  update app.mensagem_cliente set ativo = coalesce(p_ativo, true),
         titulo_pt = left(trim(p_titulo_pt), 120), texto_pt = left(trim(p_texto_pt), 3000), botao_pt = left(coalesce(nullif(trim(p_botao_pt), ''), 'Continuar'), 40),
         titulo_es = left(trim(p_titulo_es), 120), texto_es = left(trim(p_texto_es), 3000), botao_es = left(coalesce(nullif(trim(p_botao_es), ''), 'Continuar'), 40),
         versao = versao + case when p_mostrar_de_novo then 1 else 0 end, atualizado_por = app.uid(), atualizado_em = now()
   where id = 1 returning versao into v;
  return v;
end $$;
revoke execute on function app.portal_mensagem(text), app.portal_marcar_mensagem(text), app.salvar_mensagem_cliente(boolean, text, text, text, text, text, text, boolean) from public;
grant execute on function app.portal_mensagem(text), app.portal_marcar_mensagem(text), app.salvar_mensagem_cliente(boolean, text, text, text, text, text, text, boolean) to vc_app;
