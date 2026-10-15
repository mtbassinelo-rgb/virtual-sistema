/** Mostra a mensagem de sucesso ou erro devolvida por uma ação (via ?ok= / ?erro=). */
export function Avisos({ ok, erro }: { ok?: string; erro?: string }) {
  return (
    <>
      {erro && <div className="aviso-caixa erro" role="alert">{erro}</div>}
      {ok && <div className="aviso-caixa ok" role="status">{ok}</div>}
    </>
  );
}

export function Selo({ cor, children }: { cor?: string; children: React.ReactNode }) {
  return <span className={`selo ${cor ?? ""}`}>{children}</span>;
}

export function Barra({ percentual, ok }: { percentual: number; ok?: boolean }) {
  const p = Math.max(0, Math.min(100, percentual));
  return (
    <div className={`barra ${ok ? "ok" : ""}`} role="progressbar" aria-valuenow={p} aria-valuemin={0} aria-valuemax={100}>
      <span style={{ width: `${p}%` }} />
    </div>
  );
}
