-- Códigos dados no Bling em 22/10/2026 a produtos que não tinham código (no sistema estão como BLING-<id>)
do $$
declare a record; r text;
begin
  for a in select * from (values ('PHB-SAB-ANTIACNE-100', 'BLING-16684933735'), ('MAG3D-500-PLAT', 'BLING-16691348867'),
      ('SOUL-DERM-VITC-100', 'BLING-16693789767'), ('MESC-TRAD-2X300', 'BLING-16691331325'),
      ('SEMCOD-SABONETEANTIACNEPHALLEBEAUTYSALICILICOPE', 'BLING-16684933735')) t(cod, dest) loop
    r := app.ligar_codigo_marketplace(a.cod, a.dest);
    if r <> 'ok' then raise notice 'Código % → %: %', a.cod, a.dest, r; end if;
  end loop;
end $$;
