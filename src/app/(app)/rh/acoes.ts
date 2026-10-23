"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ehGestao, exigirUsuario } from "@/lib/auth";
import { comUsuario, mensagemErro } from "@/lib/db";
import { numero, texto } from "@/lib/formato";

const UUID = /^[0-9a-f-]{36}$/i;
const TIPOS = ["clt", "experiencia", "mei", "autonomo", "ips", "contrato", "estagio", "informal", "outro"];

async function gestor() {
  const u = await exigirUsuario();
  if (!ehGestao(u)) throw new Error("Só gerente ou dono mexe no RH.");
  return u;
}

function voltar(destino: string, erro: string | null, ok: string) {
  revalidatePath("/rh", "layout");
  const sep = destino.includes("?") ? "&" : "?";
  redirect(`${destino}${sep}${erro ? "erro=" + encodeURIComponent(erro) : "ok=" + encodeURIComponent(ok)}`);
}

const dataOuNulo = (fd: FormData, campo: string) => {
  const v = texto(fd, campo).trim();
  if (!v) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error("Data inválida.");
  return v;
};
const textoOuNulo = (fd: FormData, campo: string, max = 1000) => texto(fd, campo).trim().slice(0, max) || null;
const uuidOuNulo = (fd: FormData, campo: string) => {
  const v = texto(fd, campo).trim();
  return UUID.test(v) ? v : null;
};

/** Cria ou atualiza o cadastro de um funcionário. */
export async function salvarFuncionario(fd: FormData) {
  let erro: string | null = null;
  let id = texto(fd, "id");
  try {
    const u = await gestor();
    const nome = texto(fd, "nome").trim();
    if (nome.length < 2) throw new Error("Informe o nome.");
    const admissao = dataOuNulo(fd, "data_admissao");
    if (!admissao) throw new Error("Informe a data de admissão.");
    const pais = texto(fd, "pais") === "PY" ? "PY" : "BR";
    const moeda = texto(fd, "moeda") === "GS" ? "GS" : "BRL";
    const tipo = TIPOS.includes(texto(fd, "tipo_contrato")) ? texto(fd, "tipo_contrato") : "outro";
    const salario = numero(fd, "salario");
    if (salario !== null && salario < 0) throw new Error("Salário inválido.");
    const diaPag = numero(fd, "dia_pagamento");
    if (diaPag !== null && (diaPag < 1 || diaPag > 31)) throw new Error("Dia de pagamento deve ser de 1 a 31.");
    const ferAnt = numero(fd, "ferias_anteriores") ?? 0;
    if (ferAnt < 0) throw new Error("Dias de férias anteriores inválidos.");
    const valores = [
      nome, textoOuNulo(fd, "cargo", 120), pais, uuidOuNulo(fd, "deposito_id"), uuidOuNulo(fd, "usuario_id"), uuidOuNulo(fd, "vendedora_id"),
      textoOuNulo(fd, "documento", 60), textoOuNulo(fd, "whatsapp", 40), textoOuNulo(fd, "email", 160), textoOuNulo(fd, "endereco", 300),
      dataOuNulo(fd, "data_nascimento"), admissao, dataOuNulo(fd, "data_desligamento"), textoOuNulo(fd, "motivo_desligamento", 300),
      tipo, textoOuNulo(fd, "jornada", 200), salario, moeda, diaPag === null ? null : Math.trunc(diaPag),
      textoOuNulo(fd, "comissao", 300), textoOuNulo(fd, "beneficios", 500), textoOuNulo(fd, "dados_pagamento", 300),
      textoOuNulo(fd, "contato_emergencia", 200), textoOuNulo(fd, "observacoes", 2000), Math.trunc(ferAnt),
    ];
    await comUsuario(u.id, async (c) => {
      if (UUID.test(id)) {
        const r = await c.query(
          `update app.funcionarios set nome=$1, cargo=$2, pais=$3, deposito_id=$4, usuario_id=$5, vendedora_id=$6, documento=$7, whatsapp=$8,
             email=$9, endereco=$10, data_nascimento=$11, data_admissao=$12, data_desligamento=$13, motivo_desligamento=$14, tipo_contrato=$15,
             jornada=$16, salario=$17, moeda=$18, dia_pagamento=$19, comissao=$20, beneficios=$21, dados_pagamento=$22,
             contato_emergencia=$23, observacoes=$24, ferias_anteriores=$25, atualizado_em=now()
           where id=$26`, [...valores, id]);
        if (r.rowCount === 0) throw new Error("Funcionário não encontrado.");
      } else {
        const r = await c.query(
          `insert into app.funcionarios (nome, cargo, pais, deposito_id, usuario_id, vendedora_id, documento, whatsapp, email, endereco,
             data_nascimento, data_admissao, data_desligamento, motivo_desligamento, tipo_contrato, jornada, salario, moeda, dia_pagamento,
             comissao, beneficios, dados_pagamento, contato_emergencia, observacoes, ferias_anteriores)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25) returning id`, valores);
        id = String(r.rows[0].id);
      }
    });
  } catch (e) {
    erro = mensagemErro(e);
  }
  voltar(UUID.test(id) ? `/rh/funcionarios/${id}` : "/rh/funcionarios/novo", erro, "Cadastro salvo.");
}

/** Marca um período de férias (passado ou programado). */
export async function adicionarFerias(fd: FormData) {
  let erro: string | null = null;
  const id = texto(fd, "funcionario_id");
  try {
    const u = await gestor();
    if (!UUID.test(id)) throw new Error("Funcionário inválido.");
    const inicio = dataOuNulo(fd, "inicio");
    const fim = dataOuNulo(fd, "fim");
    if (!inicio || !fim) throw new Error("Informe o início e o fim das férias.");
    if (fim < inicio) throw new Error("O fim deve ser depois do início.");
    await comUsuario(u.id, async (c) => {
      const choque = await c.query(
        "select 1 from app.funcionario_ferias where funcionario_id = $1 and daterange(inicio, fim, '[]') && daterange($2::date, $3::date, '[]')",
        [id, inicio, fim]);
      if (choque.rowCount) throw new Error("Já existe férias marcadas nesse período.");
      await c.query("insert into app.funcionario_ferias (funcionario_id, inicio, fim, observacao) values ($1, $2, $3, $4)",
        [id, inicio, fim, textoOuNulo(fd, "observacao", 300)]);
    });
  } catch (e) {
    erro = mensagemErro(e);
  }
  voltar(`/rh/funcionarios/${id}#ferias`, erro, "Férias registradas.");
}

export async function removerFerias(fd: FormData) {
  let erro: string | null = null;
  const id = texto(fd, "funcionario_id");
  try {
    const u = await gestor();
    const fer = texto(fd, "ferias_id");
    if (!UUID.test(fer)) throw new Error("Registro inválido.");
    await comUsuario(u.id, (c) => c.query("delete from app.funcionario_ferias where id = $1", [fer]));
  } catch (e) {
    erro = mensagemErro(e);
  }
  voltar(`/rh/funcionarios/${id}#ferias`, erro, "Férias removidas.");
}
