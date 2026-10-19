-- Novo perfil: estoquista (separa pedidos, confere estoque e faz inventário nas unidades em que é responsável).
alter type app.perfil add value if not exists 'estoquista';
