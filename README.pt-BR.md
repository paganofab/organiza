<div align="center">

<img src="src-tauri/icons/128x128@2x.png" width="96" alt="Ícone do Organiza" />

# Organiza

**Um app desktop *local-first* para controlar contas, receitas, lembretes e seu calendário — com um bot do Telegram para adicionar lançamentos pelo celular.**

🇬🇧 [Read in English](README.md)

![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-local-003B57?logo=sqlite&logoColor=white)
![Licença](https://img.shields.io/badge/licen%C3%A7a-MIT-green)

</div>

> A interface é toda em **português (pt-BR)**, com valores em **R$** e datas no formato **dd/mm/aaaa**.

---

## ✨ Funcionalidades

- **📊 Dashboard** — visão do mês: receitas, despesas, saldo, próximos vencimentos, contas atrasadas, gráfico de gastos por categoria, progresso dos orçamentos e lembretes.
- **💸 Contas e receitas** — CRUD completo com categorias, lançamentos **recorrentes**, **parcelamentos** (ex: 12×), status de pago/recebido, anexo de comprovantes e seletor despesa/receita.
- **📅 Calendário** — visão mensal combinando eventos, vencimentos de contas e lembretes.
- **🔔 Lembretes (lista de tarefas)** — tarefas com data/hora opcional, **recorrência** (diária/semanal/mensal), conclusão por checkbox e notificação do sistema ao vencer.
- **📈 Relatórios e fluxo de caixa** — evolução mensal, gastos por categoria, exportação para CSV e previsão de fluxo de caixa de 6–12 meses com base nos compromissos já lançados.
- **🎯 Orçamento por categoria** — defina um teto mensal e acompanhe o consumo no dashboard.
- **🤖 Bot do Telegram** — adicione contas, receitas e lembretes por texto, em português natural:
  - `conta de água 12 dezembro 250 reais`
  - `recebi 5500 salário dia 5`
  - `lembrar de ligar pro médico amanhã às 9h`
  - Faça perguntas: `saldo`, `quanto gastei`, `próximos vencimentos`, `atrasadas`, `lembretes`
  - Botões para definir categoria, marcar como pago/concluído ou excluir
  - **Resumo diário** opcional toda manhã com o que vence no dia + atrasadas
- **💾 Backup e restauração** — backups automáticos diários (mantém os 10 mais recentes) e exportação/importação manual.
- **🌙 Modo escuro**, **autostart** (abre em segundo plano com o sistema) e **lembretes por e-mail (SMTP)**.
- **🔒 Local e privado** — todos os dados ficam num banco SQLite local na sua máquina. Sem nuvem, sem conta.

## 🛠️ Tecnologias

| Camada | Tecnologia |
|------|------|
| Shell | [Tauri 2](https://tauri.app) (Rust) |
| Frontend | React 19 + TypeScript + Vite |
| Banco | SQLite via [`tauri-plugin-sql`](https://github.com/tauri-apps/plugins-workspace) |
| Gráficos | [Recharts](https://recharts.org) |
| Ícones | [Lucide](https://lucide.dev) |
| E-mail | [lettre](https://lettre.rs) (SMTP, Rust) |
| Telegram | Bot API via `reqwest` (comando Rust) |

## 🚀 Como rodar

### Pré-requisitos

- [Node.js](https://nodejs.org) 18+
- [Rust](https://www.rust-lang.org/tools/install) (stable) + os [pré-requisitos do Tauri](https://tauri.app/start/prerequisites/) para o seu sistema

### Desenvolvimento

```bash
npm install
npm run tauri dev
```

### Gerar o app instalável

```bash
npm run tauri build
```

O instalador é gerado em `src-tauri/target/release/bundle/` (ex: `.dmg` no macOS, `.msi`/`.exe` no Windows, `.deb`/`.AppImage` no Linux).

## 🤖 Configurando o bot do Telegram

1. No Telegram, fale com o **@BotFather**, envie `/newbot` e siga os passos para obter o **token**.
2. No app: **Configurações → Telegram**, cole o token e salve.
3. Envie qualquer mensagem para o seu bot para parear (só o primeiro chat que falar com o bot fica autorizado).
4. Comece a lançar e a perguntar. Envie `/menu` para o bot ver toda a sintaxe.

> O bot consulta o Telegram enquanto o app está rodando (o computador precisa estar ligado/acordado). Para entrega 24/7 seria necessário um webhook na nuvem — fora do escopo deste app local.

## 📁 Estrutura do projeto

```
src/
  pages/        # Dashboard, Contas, Calendário, Lembretes, Relatórios, Fluxo de caixa, Configurações
  components/   # Modal e formulários de lançamento
  lib/          # db, parser, telegram, reminders, consultas, backup, format, types
src-tauri/
  src/lib.rs    # comandos Rust (migrações SQL, e-mail, HTTP do Telegram, backup, anexos)
scripts/
  testar-parser.ts  # testes do parser de mensagens em pt-BR
```

Rode os testes do parser com:

```bash
npx esbuild scripts/testar-parser.ts --bundle --format=esm | node --input-type=module
```

## 🗄️ Onde ficam meus dados?

Num único arquivo SQLite na pasta de dados do app do sistema, ex: no macOS:
`~/Library/Application Support/com.fabio.organiza/organiza.db`. Ele sobrevive a reinstalações, e os backups automáticos ficam numa subpasta `backups/`.

## 📄 Licença

[MIT](LICENSE) © Fabio

---

<div align="center">
Feito com <a href="https://tauri.app">Tauri</a> · Controle financeiro pessoal, em português.
</div>
