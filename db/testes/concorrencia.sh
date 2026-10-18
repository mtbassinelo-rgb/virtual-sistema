#!/usr/bin/env bash
# Pedidos simultâneos disputando o mesmo estoque (depósito com fonte Bling).
# Duas conexões ao mesmo tempo tentam reservar 5 unidades de um produto com 8 disponíveis:
#   - com a trava (app.travar_saldos), só uma consegue;
#   - sem a trava (controle), as duas conseguiriam — prova que o teste detecta o problema.
# Rodar depois de testes/bling_estoque.sql, num banco de TESTE.
set -uo pipefail
: "${DATABASE_URL:?Defina DATABASE_URL (banco de teste)}"
q() { psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -qtAX "$@"; }

q -c "create table if not exists teste.disputa (rodada text, sessao int, conseguiu boolean)"
q -c "truncate teste.disputa"

tentar() { # $1 rodada, $2 sessão, $3 usa trava (true/false)
  q -c "do \$\$
declare v_cd uuid := (select id from app.depositos where codigo = 'cd-foz');
        v_x uuid := '00000000-0000-0000-0000-0000000bb001'; v_ped uuid; v_disp numeric;
begin
  if $3 then perform app.travar_saldos(array[v_cd], array[v_x]); end if;
  v_disp := app.saldo_disponivel(v_cd, v_x);
  perform pg_sleep(0.3);
  if v_disp >= 5 then
    insert into app.pedidos (origem, cliente_id, vendedora_id, data_pedido, moeda, valor_total, deposito_id)
    values ('manual','00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000a1', current_date, 'GS', 1, v_cd)
    returning id into v_ped;
    insert into app.pedido_itens (pedido_id, produto_id, codigo, descricao, quantidade, preco_unitario)
    values (v_ped, v_x, 'TB-X', 'Produto X', 5, 1);
    perform pg_sleep(1);
  end if;
  insert into teste.disputa values ('$1', $2, v_disp >= 5);
end \$\$"
}

limpar() { # cancela os pedidos de disputa para a próxima rodada
  q -c "update app.pedidos set status_comercial = 'cancelado'
         where id in (select pedido_id from app.estoque_reservas where produto_id = '00000000-0000-0000-0000-0000000bb001'
                        and status = 'ativa' and quantidade = 5)"
}

antes=$(q -c "select app.saldo_disponivel((select id from app.depositos where codigo='cd-foz'), '00000000-0000-0000-0000-0000000bb001')::int")

# Controle: sem trava
tentar sem_trava 1 false & tentar sem_trava 2 false & wait
limpar
# Com trava
tentar com_trava 1 true & tentar com_trava 2 true & wait

sem=$(q -c "select count(*) from teste.disputa where rodada = 'sem_trava' and conseguiu")
com=$(q -c "select count(*) from teste.disputa where rodada = 'com_trava' and conseguiu")
depois=$(q -c "select app.saldo_disponivel((select id from app.depositos where codigo='cd-foz'), '00000000-0000-0000-0000-0000000bb001')::int")
limpar

echo "  disponível antes: $antes · sem trava: $sem pedido(s) reservaram · com trava: $com · disponível depois: $depois"
[ "$antes" = "8" ] || { echo "FALHOU: esperado 8 disponíveis antes da disputa"; exit 1; }
[ "$sem" = "2" ] || { echo "FALHOU: o controle sem trava deveria mostrar a dupla reserva"; exit 1; }
[ "$com" = "1" ] || { echo "FALHOU: com a trava só um pedido pode levar as unidades"; exit 1; }
[ "$depois" = "3" ] || { echo "FALHOU: depois da disputa deveriam sobrar 3"; exit 1; }
echo "== Teste de pedidos simultâneos passou =="
