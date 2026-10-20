-- Saúde financeira: área exclusiva do dono (permissão "saude_financeira", só o dono libera).
-- A Cristina (gerente e sócia) também vê. Se ela já for dono, tem acesso de qualquer jeito.
-- Se o nome dela no sistema não começar com "Cristina", libere em Equipe → Acessos (entrando como dono).
update app.usuarios
   set permissoes = permissoes || '{"saude_financeira": true}'::jsonb
 where ativo
   and perfil = 'gerente'
   and nome ilike 'cristina%';
