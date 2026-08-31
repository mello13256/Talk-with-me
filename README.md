# Talk with me

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/mello13256/Talk-with-me/tree/claude/private-client-messaging-system-ga3zyt)

> **Quer só ver funcionando online?** Clique no botão acima. O Render lê este
> repositório, cria o serviço e o banco, e devolve uma URL do tipo
> `https://talk-with-me.onrender.com`. A única coisa que você digita é o e-mail
> do administrador. Detalhes na [seção 7](#7-deploy-em-produção).

Um canal privado de atendimento entre **você (administrador)** e **cada um dos seus clientes**.
Não é um grupo, não é um fórum e não existe comunicação entre clientes: cada cliente tem uma
conversa isolada, 1 para 1, com você.

- **Área do cliente** — cadastro, login, recuperação de senha, perfil, chat em tempo real, envio de
  arquivos e imagens, histórico completo, status de envio/leitura, indicador de online/offline e
  notificações.
- **Painel administrativo** — lista lateral de conversas com destaque para não lidas, busca de
  clientes e de mensagens, histórico completo, resolver/reabrir, bloquear/desbloquear, criar, editar
  e excluir clientes, além de métricas de atendimento.

---

## Sumário

1. [Arquitetura](#1-arquitetura)
2. [Estrutura de pastas](#2-estrutura-de-pastas)
3. [Schema do banco de dados](#3-schema-do-banco-de-dados)
4. [Variáveis de ambiente](#4-variáveis-de-ambiente)
5. [Rodando localmente](#5-rodando-localmente)
6. [Criando a conta de administrador](#6-criando-a-conta-de-administrador)
7. [Deploy em produção](#7-deploy-em-produção)
8. [Segurança](#8-segurança)
9. [Checklist de testes](#9-checklist-de-testes)
10. [Operação e manutenção](#10-operação-e-manutenção)

---

## 1. Arquitetura

### A escolha, em uma frase

**Um único processo Node.js** que serve a API REST, o WebSocket e o próprio frontend já compilado,
falando com **um único PostgreSQL**. Um serviço, um banco, um domínio.

### Por que esta arquitetura

| Critério | Como esta escolha atende |
| --- | --- |
| **Segurança** | Frontend e API na mesma origem: o cookie de sessão pode ser `HttpOnly` + `SameSite=Lax` sem depender de CORS. Nenhum token fica acessível a JavaScript. |
| **Simplicidade** | Sem gateway, sem fila, sem serviço separado de realtime. Um `git push` publica tudo de uma vez. |
| **Performance** | O WebSocket vive no mesmo processo que escreve as mensagens: a entrega é imediata, sem hop de rede intermediário. |
| **Deploy** | Um `Dockerfile`, um `render.yaml`, um `fly.toml`. Funciona em Render, Railway, Fly.io ou em uma VPS com Docker. |
| **Manutenção** | TypeScript estrito nas duas pontas, tipos compartilhados por convenção, migrações SQL numeradas e legíveis. |
| **Custo** | Roda confortavelmente na faixa de US$ 0–7/mês (1 serviço + 1 Postgres pequeno). |

### Stack

**Backend** — Node.js 22 · TypeScript · Express · Socket.IO · PostgreSQL 16 (driver `pg`) ·
Zod (validação) · bcrypt (senhas) · Helmet (cabeçalhos) · `web-push` (notificações do navegador).

**Frontend** — React 18 · TypeScript · Vite · Tailwind CSS v4 · React Router · Socket.IO client.

**Decisões que valem explicação:**

- **Sem ORM.** As consultas usam SQL parametrizado direto (`pg`). Não há etapa de code generation nem
  binário para baixar no deploy, as migrações são arquivos `.sql` legíveis, e a proteção contra SQL
  injection fica *estrutural*: não existe uma única query montada por concatenação de string neste
  código.
- **Sessões opacas em vez de JWT.** O token é aleatório e só o digest HMAC é guardado no banco.
  Bloquear um cliente ou trocar a senha **revoga o acesso na hora** — algo que um JWT sem lista de
  revogação não consegue fazer.
- **Arquivos nunca são públicos.** O bucket/pasta é privado; todo download passa por
  `GET /api/attachments/:id`, que verifica a permissão antes de entregar um único byte.
- **Compressão de imagem no navegador.** Uma foto de celular de 6 MB vira ~300 KB antes de sair do
  aparelho: o chat parece instantâneo no 4G e o custo de armazenamento cai junto.

### Fluxo de uma mensagem

```
Cliente digita
      │
      ├─ (anexo) POST /api/attachments ──► valida MIME + magic bytes ──► object storage
      │                                     (linha em `attachments`, ainda sem message_id)
      │
      └─ POST /api/conversations/:id/messages
                │
                ├─ authorizeConversation()  ← WHERE client_id = <usuário logado>
                ├─ transação: INSERT message + vincula anexos + reabre conversa se resolvida
                │
                └─ broadcast
                     ├─ socket "message:new"        → sala da conversa + sala do destinatário
                     ├─ socket "conversation:updated" → painel do administrador
                     └─ notificação in-app (+ Web Push se o destinatário estiver offline)
```

---

## 2. Estrutura de pastas

```
talk-with-me/
├── package.json                  # npm workspaces: server + web
├── docker-compose.yml            # Postgres para desenvolvimento
├── Dockerfile                    # imagem de produção (build multi-stage)
├── render.yaml / fly.toml        # blueprints de deploy gerenciado
├── docker-compose.prod.yml       # stack completa: app + Postgres + Caddy (VM própria)
├── deploy/
│   ├── Caddyfile                 # proxy reverso com HTTPS automático
│   └── setup-vm.sh               # provisiona uma VM Ubuntu do zero
├── .env.example                  # todas as variáveis, documentadas
│
├── server/
│   ├── src/
│   │   ├── index.ts              # bootstrap: migrações, HTTP, WebSocket, shutdown
│   │   ├── app.ts                # Express: helmet/CSP, CORS, rotas, SPA estática
│   │   ├── config/env.ts         # validação do ambiente com Zod (falha rápido)
│   │   ├── db/
│   │   │   ├── pool.ts           # pool + helpers (query/one/maybeOne/withTransaction)
│   │   │   ├── migrate.ts        # runner com advisory lock (seguro em rolling deploy)
│   │   │   └── migrations/       # 001_init.sql, 002_...
│   │   ├── lib/                  # crypto, senhas, e-mail, erros, logger, serializers
│   │   ├── middleware/           # auth, csrf, rate limit, upload, erros
│   │   ├── modules/
│   │   │   ├── auth/             # sessões, registro, login, recuperação de senha
│   │   │   ├── users/            # perfil e avatar
│   │   │   ├── conversations/    # autorização, leitura, envio, busca na conversa
│   │   │   ├── messages/         # paginação keyset, criação, leitura, exclusão
│   │   │   ├── attachments/      # allow-list, magic bytes, download autorizado
│   │   │   ├── notifications/    # notificações in-app e Web Push
│   │   │   └── admin/            # diretório de clientes, métricas, auditoria
│   │   ├── realtime/
│   │   │   ├── hub.ts            # registro de presença e helpers de emissão
│   │   │   └── socket.ts         # autenticação do handshake e handlers
│   │   ├── storage/              # drivers local e S3 (interface única)
│   │   └── scripts/create-admin.ts
│   └── tests/                    # vitest — foco no que é crítico para segurança
│
└── web/
    ├── index.html
    ├── public/                   # sw.js (Web Push), manifest, favicon, theme.js
    └── src/
        ├── App.tsx               # rotas e guardas
        ├── styles/index.css      # design tokens (claro/escuro) + base
        ├── lib/                  # api client, tipos, formatação, linkify, imagem, push
        ├── context/              # Auth, Socket, Theme, Toast
        ├── hooks/                # useConversation, useAdminClients, useNotifications
        ├── components/
        │   ├── ui/               # Button, Field, Modal, Avatar, Badge, Menu, ícones…
        │   ├── chat/             # MessageList, MessageBubble, Composer, Lightbox…
        │   ├── admin/            # ClientList, ClientDetailsPanel, ClientFormModal
        │   └── layout/           # AppHeader, NotificationBell, ConnectionBadge…
        └── pages/                # landing, auth, cliente, admin
```

---

## 3. Schema do banco de dados

Arquivo: [`server/src/db/migrations/001_init.sql`](server/src/db/migrations/001_init.sql).

### Diagrama de relações

```
                          ┌───────────────────────────┐
                          │          users            │
                          │  id · email(citext,uniq)  │
                          │  password_hash · name     │
                          │  role: client | admin     │
                          │  is_blocked · is_online   │
                          │  last_seen_at · notes     │
                          └───┬───────┬───────┬───────┘
             1:N              │       │       │              1:1
   ┌──────────────────────────┘       │       └──────────────────────────┐
   │                                  │                                  │
┌──┴───────────────┐   ┌──────────────┴──────┐          ┌────────────────┴──────────┐
│    sessions      │   │   notifications     │          │      conversations        │
│ token_hash(uniq) │   │  type · title       │          │  client_id  UNIQUE ◄──────┤
│ expires_at       │   │  read_at            │          │  status: open | resolved  │
│ revoked_at       │   └─────────────────────┘          │  last_message_at          │
└──────────────────┘                                    └────────────┬──────────────┘
┌──────────────────┐   ┌─────────────────────┐                       │ 1:N
│ password_reset_  │   │ push_subscriptions  │          ┌────────────┴──────────────┐
│ tokens           │   │  endpoint (uniq)    │          │         messages          │
│ token_hash(uniq) │   │  p256dh · auth      │          │  sender_id (NULL=sistema) │
│ used_at          │   └─────────────────────┘          │  body · kind              │
└──────────────────┘                                    │  reply_to_id ──┐ (auto-ref)│
┌──────────────────┐   ┌─────────────────────┐          │  client_nonce  │           │
│  login_attempts  │   │      audit_log      │          │  read_at ◄── status leitura│
│  email · ip      │   │  actor_id · action  │          │  deleted_at (soft delete)  │
│  success         │   │  target · metadata  │          │  search_vector (tsvector)  │
└──────────────────┘   └─────────────────────┘          └────────────┬──────────────┘
                                                                     │ 1:N
                                                        ┌────────────┴──────────────┐
                                                        │       attachments         │
                                                        │  purpose: message|avatar  │
                                                        │  conversation_id ─────────┤
                                                        │  uploader_id              │
                                                        │  storage_key (uniq)       │
                                                        │  mime_type · size_bytes   │
                                                        └───────────────────────────┘
```

### As relações, em texto

| Relação | Cardinalidade | O que garante |
| --- | --- | --- |
| `users` → `conversations` | **1 : 1** | `conversations.client_id` é `UNIQUE`. Cada cliente tem exatamente uma conversa — a regra "1 cliente ↔ 1 administrador" é uma **restrição do banco**, não uma convenção da aplicação. |
| `conversations` → `messages` | 1 : N | `ON DELETE CASCADE`: apagar a conversa apaga o histórico. |
| `messages` → `messages` | auto-referência | `reply_to_id` permite responder uma mensagem específica. `ON DELETE SET NULL`. |
| `messages` → `attachments` | 1 : N | O anexo é criado **antes** da mensagem (`message_id` nulo) e vinculado no envio. Anexos abandonados são varridos a cada 6 h. |
| `users` → `attachments` (avatar) | 1 : 1 | `users.avatar_attachment_id`, `ON DELETE SET NULL`. |
| `users` → `sessions` | 1 : N | Uma linha por dispositivo. `ON DELETE CASCADE`. |
| `users` → `notifications` | 1 : N | Notificações in-app, colapsadas em uma por conversa não lida. |
| `users` → `push_subscriptions` | 1 : N | Um endpoint Web Push por navegador/dispositivo. |
| `users` → `audit_log` | 1 : N | Registro de toda ação administrativa privilegiada. |

### Decisões de modelagem que valem destacar

**Status de leitura em `messages.read_at`, não em uma tabela de recibos.**
A conversa é 1:1, então cada mensagem tem exatamente **um** destinatário. Uma coluna resolve o
problema com um índice parcial minúsculo, em vez de uma tabela `message_receipts` que cresceria
junto com o histórico:

```sql
CREATE INDEX messages_unread_idx ON messages (conversation_id, sender_id)
  WHERE read_at IS NULL AND deleted_at IS NULL;
```

Quem é o destinatário sai de um predicado avaliado sempre contra `conversations.client_id` — nunca
contra um valor vindo da requisição:

- caixa do **cliente**: `m.sender_id IS DISTINCT FROM c.client_id` (mensagens do admin e do sistema);
- caixa do **administrador**: `m.sender_id = c.client_id` (só o que o cliente escreveu).

**Colunas de posse em todas as tabelas filhas.** `attachments` carrega `conversation_id` e
`uploader_id` mesmo sendo alcançável via `messages`. Isso permite escrever a autorização **dentro do
`WHERE`** em vez de checá-la no código — e um handler distraído não consegue vazar dados de outro
cliente.

**`client_nonce` para idempotência.** Reenviar após um timeout devolve a mensagem original em vez de
duplicá-la (índice único parcial em `conversation_id, sender_id, client_nonce`).

**Busca full-text nativa.** `messages.search_vector` é uma coluna gerada
(`to_tsvector('portuguese', body)`) com índice GIN — busca por relevância sem Elasticsearch.

**Exclusão é soft delete.** `deleted_at` preserva a integridade das respostas encadeadas; o corpo é
zerado no banco e as linhas de `attachments` (mais os arquivos) são removidas de fato.

---

## 4. Variáveis de ambiente

Copie `.env.example` para `.env` na raiz e preencha. **Nenhum segredo fica no código.**
O servidor valida tudo na inicialização com Zod e **recusa subir** com configuração inválida.

Gere os segredos com:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

### Obrigatórias

| Variável | Descrição |
| --- | --- |
| `DATABASE_URL` | String de conexão do PostgreSQL. |
| `SESSION_SECRET` | ≥ 32 caracteres. Deriva o digest dos tokens de sessão e de recuperação. **Trocar desconecta todo mundo.** |
| `PASSWORD_PEPPER` | ≥ 16 caracteres. Misturado a toda senha antes do bcrypt. **Trocar invalida TODAS as senhas** — trate como permanente. |
| `APP_URL` | URL pública do app. Usada nos links de recuperação de senha e nas notificações push. |

### Importantes em produção

| Variável | Padrão | Observação |
| --- | --- | --- |
| `NODE_ENV` | `development` | `production` liga HSTS e cookies `Secure`. |
| `TRUST_PROXY` | `0` | Nº de proxies à frente. Render/Railway/Fly = `1`. **Sem isso o rate limit vê o IP do proxy, não o do visitante.** |
| `DATABASE_SSL` | `false` | `true` em provedores gerenciados (Neon, Supabase, Railway, Render). |
| `DATABASE_POOL_MAX` | `10` | Reduza para `5` em bancos com poucas conexões, como o plano free do Supabase. |
| `ALLOW_PUBLIC_REGISTRATION` | `true` | `false` deixa o cadastro apenas por convite do administrador. |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_NAME` | vazio | Cria o administrador no primeiro boot, **apenas se não existir nenhum**. Remova `ADMIN_PASSWORD` depois de entrar. Veja a [seção 6](#6-criando-a-conta-de-administrador). |
| `CORS_ORIGINS` | vazio | Deixe vazio se API e frontend estiverem no mesmo domínio (recomendado). |
| `MAX_UPLOAD_MB` | `25` | Limite por arquivo. |
| `BCRYPT_COST` | `12` | Aumente se o servidor for rápido. |

### Armazenamento de arquivos

| Variável | Descrição |
| --- | --- |
| `STORAGE_DRIVER` | `local` (disco) ou `s3` (qualquer bucket compatível com S3). |
| `STORAGE_LOCAL_DIR` | Só para `local`. Precisa de um volume persistente em produção. |
| `S3_BUCKET`, `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Para `s3`. **O bucket deve ser privado** — os downloads sempre passam pela API. |

### E-mail e notificações

| Variável | Descrição |
| --- | --- |
| `MAIL_DRIVER` | `console` (só desenvolvimento), `brevo`, `smtp` ou `resend`. Em produção `console` é rejeitado, a menos que `ALLOW_INSECURE_MAIL=true`. **Em hospedagem, use `brevo`:** ele envia por API HTTP na porta 443, e a maioria das plataformas (Render, Vercel, Fly free) bloqueia a saída SMTP — com `smtp` o envio falha com `Connection timeout` mesmo com tudo correto. O Brevo ainda permite verificar um remetente avulso, então funciona sem domínio próprio; o Resend exige domínio verificado. `smtp` continua útil em servidor próprio. |
| `ALLOW_INSECURE_MAIL` | `false`. Só ligue no primeiro deploy: com `console`, os links de recuperação ficam apenas no log e o cliente não recupera a senha sozinho. |
| `MAIL_FROM` | Remetente. Com `brevo`, precisa ser exatamente o endereço verificado na conta. |
| `BREVO_API_KEY`, `SMTP_*`, `RESEND_API_KEY` | Conforme o driver escolhido. |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Opcionais. Sem eles, o app funciona normalmente e apenas o Web Push fica desligado. Gere com `npx web-push generate-vapid-keys`. |

---

## 5. Rodando localmente

**Pré-requisitos:** Node.js 20+ e PostgreSQL 16 (ou Docker).

```bash
# 1. Dependências
npm install

# 2. Banco de dados (via Docker; ou use um Postgres já instalado)
npm run db:up

# 3. Configuração
cp .env.example .env
# edite .env: preencha SESSION_SECRET e PASSWORD_PEPPER com valores aleatórios

# 4. Migrações
npm run migrate

# 5. Conta de administrador (veja a seção 6)
npm run seed:admin -- --email voce@exemplo.com --name "Seu Nome"

# 6. Subir tudo (API em :4000, frontend em :5173 com proxy para a API)
npm run dev
```

Abra **http://localhost:5173**.

Com `MAIL_DRIVER=console`, os links de recuperação de senha são impressos no terminal do servidor —
basta copiar e colar no navegador.

### Scripts disponíveis

| Comando | O que faz |
| --- | --- |
| `npm run dev` | API com hot reload + Vite dev server. |
| `npm run build` | Compila frontend e backend para produção. |
| `npm start` | Sobe o servidor de produção (serve API + SPA na mesma porta). |
| `npm run migrate` | Aplica as migrações pendentes. |
| `npm run seed:admin` | Cria ou promove a conta de administrador. |
| `npm run typecheck` | TypeScript estrito nos dois workspaces. |
| `npm test` | Suíte de testes do backend. |
| `npm run db:up` / `db:down` | Sobe/derruba o Postgres de desenvolvimento. |

---

## 6. Criando a conta de administrador

**Não existe cadastro de administrador pela interface.** A rota pública de registro cria o papel
`client` com o valor fixo no SQL — não há campo, corpo de requisição ou parâmetro capaz de virar
`admin`. A promoção acontece apenas por um script executado com acesso ao servidor.

### Modo A — variáveis de ambiente (sem terminal, ideal para deploy)

Defina no painel do provedor:

| Variável | Valor |
| --- | --- |
| `ADMIN_EMAIL` | seu e-mail |
| `ADMIN_PASSWORD` | uma senha forte (o Render gera uma para você) |
| `ADMIN_NAME` | o nome que os clientes veem |

Na próxima inicialização a conta é criada. **Depois de entrar, remova
`ADMIN_PASSWORD` do ambiente e troque a senha dentro do app.**

Este caminho é deliberadamente estreito, para não virar uma porta dos fundos:

- só roda quando **não existe nenhum administrador** no banco — apontar essas
  variáveis para outro e-mail depois **não** cria um segundo administrador nem
  assume uma conta existente;
- recusa senha fraca, com a mesma política de todo o resto do sistema;
- a senha nunca é registrada em log;
- o servidor avisa a cada boot enquanto `ADMIN_PASSWORD` continuar definida.

### Modo B — script pelo terminal, senha gerada pelo servidor

```bash
npm run seed:admin -- --email voce@exemplo.com --name "Seu Nome"
```

Saída:

```
============================================
  E-mail: voce@exemplo.com
  Senha:  kZ8x2Qm4vP9nLbT7Aa1!
  Guarde esta senha agora — ela não será exibida de novo.
  Troque-a no primeiro acesso em Perfil > Segurança.
============================================
```

A senha é gerada com `crypto.randomBytes`, mostrada **uma única vez** e gravada apenas como hash
bcrypt. Não vai para log nem para o histórico do shell.

### Modo C — script com senha própria

```bash
ADMIN_EMAIL=voce@exemplo.com ADMIN_NAME="Seu Nome" ADMIN_PASSWORD='...' npm run seed:admin
```

A senha passa pela mesma política do restante do sistema; uma senha fraca é recusada.

### Em produção

```bash
# Render / Railway
<abrir o shell do serviço>  npm run seed:admin -- --email voce@exemplo.com --name "Seu Nome"

# Fly.io
fly ssh console -C "npm run seed:admin -- --email voce@exemplo.com --name 'Seu Nome'"

# Docker
docker compose exec app npm run seed:admin -- --email voce@exemplo.com --name "Seu Nome"
```

O script é idempotente: rodar de novo com o mesmo e-mail **redefine a senha e revoga todas as
sessões** daquele administrador — é também o procedimento de recuperação caso você perca o acesso.

> Depois de criar o administrador, considere `ALLOW_PUBLIC_REGISTRATION=false` se preferir cadastrar
> os clientes você mesmo pelo painel (o sistema gera uma senha temporária de uso único para cada um).

---

## 7. Deploy em produção

### Escolhendo onde hospedar

Uma restrição manda em tudo: **o processo Node precisa ficar acordado**, porque o
chat é WebSocket. Planos gratuitos que hibernam por inatividade derrubam as
conexões abertas e fazem a primeira mensagem esperar um boot frio. Banco e
arquivos são fáceis de resolver de graça; o processo é o gargalo.

O app usa **~85 MB de RAM** e ~54 MB em disco, então cabe na menor instância de
qualquer lugar. Medido, não estimado.

| Opção | Custo/mês | Sempre no ar | Trabalho | Quando faz sentido |
| --- | --- | --- | --- | --- |
| **VM Always Free (Oracle) ou VPS** + `docker-compose.prod.yml` | **US$ 0** | ✅ | Médio — uma VM para manter | **Recomendado se você quer custo zero de verdade.** Banco, arquivos e HTTPS incluídos, sem serviço externo e sem pausa. |
| **Fly.io** | ~US$ 2 | ✅ | Baixo | Melhor relação esforço/preço. `fly.toml` pronto; retoma rápido porque suspende em vez de desligar. |
| **Render + Supabase** | ~US$ 7 | ✅ | Muito baixo | O caminho de um clique. Você paga pela conveniência do web service. |
| Render free + ping externo | US$ 0 | ⚠️ frágil | Baixo | Só para testar. Ver a ressalva abaixo. |

> **Sobre manter o plano free do Render acordado com um ping externo:** funciona,
> cabe nas 750 horas/mês e é tentador. Mas o plano free **não tem disco
> persistente** (você precisa de S3 para os anexos), e manter vivo
> artificialmente um serviço projetado para hibernar é frágil por natureza —
> depende de um pinger de terceiros e de o provedor não fechar a brecha. Para um
> teste, tudo bem. Para o seu canal principal com clientes, não confie nisso.

### Antes de qualquer deploy

1. Gere `SESSION_SECRET` e `PASSWORD_PEPPER` e guarde-os no gerenciador de segredos do provedor.
2. Defina `APP_URL` com o domínio real e `https://`.
3. Defina `TRUST_PROXY=1` e `DATABASE_SSL=true`.
4. Configure e-mail (`MAIL_DRIVER=brevo`; `smtp` só em servidor próprio, porque plataformas de
   hospedagem bloqueiam a saída SMTP) — sem isso a recuperação de senha não funciona,
   e o servidor recusa subir com `console` em produção (a menos que `ALLOW_INSECURE_MAIL=true`).
5. Escolha o armazenamento: `s3` (recomendado) ou `local` **com volume persistente**.

> As migrações rodam sozinhas na inicialização, dentro de uma transação protegida por advisory lock
> — um rolling deploy com várias instâncias não aplica a mesma migração duas vezes.

### Opção 0 — VM própria, custo zero e sempre no ar

A stack completa (**app + PostgreSQL + Caddy com HTTPS automático**) em um comando.
Serve para a camada Always Free da Oracle Cloud, para uma VM da AWS/GCP ou para
qualquer VPS de US$ 4.

**Numa VM Ubuntu limpa, com o DNS do domínio já apontando para o IP dela:**

```bash
curl -fsSL https://raw.githubusercontent.com/mello13256/Talk-with-me/claude/private-client-messaging-system-ga3zyt/deploy/setup-vm.sh | bash
```

O script instala o Docker, clona o repositório, gera todos os segredos, pergunta
três coisas (domínio, e-mail do certificado, e-mail do administrador) e sobe tudo.
A senha do administrador é gerada e mostrada uma vez.

O que você ganha por US$ 0: banco no mesmo host (sem pausa, sem limite de linhas),
anexos em volume persistente (sem S3), HTTPS renovado sozinho pelo Caddy, e
nenhuma dependência externa que possa hibernar.

O que você assume: é uma VM sua. Atualizações de sistema e backup são seu
trabalho. Faça `pg_dump` do volume `pgdata` periodicamente.

> **Por que Caddy e não Nginx:** o Caddy repassa o upgrade de WebSocket por
> padrão e emite o certificado sozinho. A configuração de Nginx equivalente exige
> `proxy_set_header Upgrade`/`Connection` na mão — é o esquecimento mais comum e
> quebra exatamente o chat em tempo real, de um jeito que só aparece em produção.

Operação do dia a dia:

```bash
cd ~/talk-with-me
sudo docker compose -f docker-compose.prod.yml logs -f app     # logs
sudo docker compose -f docker-compose.prod.yml pull && \
  sudo docker compose -f docker-compose.prod.yml up -d --build  # atualizar
sudo docker compose -f docker-compose.prod.yml exec db \
  pg_dump -U talkwithme talkwithme > backup-$(date +%F).sql     # backup
```

### Opção A — Render, um clique (caminho mais curto até uma URL)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/mello13256/Talk-with-me/tree/claude/private-client-messaging-system-ga3zyt)

O `render.yaml` foi escrito para subir **sem configuração manual**:

1. Clique no botão e entre com sua conta do GitHub.
2. Preencha o único campo pedido: **`ADMIN_EMAIL`** (seu e-mail de acesso).
3. **Apply**. O Render cria o web service e o PostgreSQL, gera `SESSION_SECRET`,
   `PASSWORD_PEPPER` e `ADMIN_PASSWORD`, e roda as migrações no primeiro boot.
4. Em **Environment**, copie o valor gerado de `ADMIN_PASSWORD`.
5. Abra a URL do serviço, entre com esse e-mail e senha, e troque a senha em
   **Perfil → Alterar senha**.
6. Volte em **Environment** e **apague `ADMIN_PASSWORD`**.

Build: `npm ci && npm run build` · Start: `npm run start --workspace=server` · Health: `/api/health`.

#### Antes de abrir para clientes reais

O blueprint troca duas garantias por conveniência no primeiro deploy, e o
servidor avisa sobre as duas no log a cada inicialização:

| Padrão do blueprint | Consequência | O que trocar |
| --- | --- | --- |
| `MAIL_DRIVER=console` + `ALLOW_INSECURE_MAIL=true` | Os links de recuperação de senha só aparecem no log do Render — **seus clientes não conseguem recuperar a senha sozinhos** | `MAIL_DRIVER=brevo` + `BREVO_API_KEY` + `MAIL_FROM` com o remetente verificado no Brevo, e remova `ALLOW_INSECURE_MAIL`. Não use `smtp`: o Render bloqueia a saída SMTP |
| `STORAGE_DRIVER=local` | Os anexos ficam no disco de 1 GB do serviço | `STORAGE_DRIVER=s3` com um bucket privado (Cloudflare R2 não cobra egress) |

Ambas são variáveis de ambiente: mudar não exige tocar no código.

### Opção B — Fly.io (Docker, bom para custo baixo)

```bash
fly launch --no-deploy
fly postgres create --name talk-with-me-db
fly postgres attach talk-with-me-db          # define DATABASE_URL

fly secrets set \
  SESSION_SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")" \
  PASSWORD_PEPPER="$(node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))")" \
  APP_URL="https://talk-with-me.fly.dev" \
  MAIL_DRIVER=brevo MAIL_FROM="Talk with me <remetente-verificado@exemplo.com>" BREVO_API_KEY="..."

fly volumes create talk_with_me_data --size 3   # só se STORAGE_DRIVER=local
fly deploy
fly ssh console -C "npm run seed:admin -- --email voce@exemplo.com --name 'Seu Nome'"
```

`min_machines_running = 1` no `fly.toml` é intencional: WebSocket precisa de uma máquina acordada.

### Opção B2 — Supabase como banco (reduz o custo pela metade)

O Supabase **é** PostgreSQL, então basta apontar `DATABASE_URL` para lá — nada no
código muda. Combinado com um web service no Render, o custo cai de ~US$ 14 para
~US$ 7/mês, porque o banco passa a ser gratuito.

**1. Crie o projeto** em [supabase.com](https://supabase.com) e vá em
**Project Settings → Database → Connection string**.

**2. Escolha a string certa — este é o detalhe que quebra deploys.** O Supabase
oferece três, e elas não são intercambiáveis:

| Opção | Porta | Serve? |
| --- | --- | --- |
| **Session pooler** | 5432 (host `...pooler.supabase.com`) | ✅ **Recomendada.** Funciona por IPv4 e mantém semântica de sessão. |
| **Transaction pooler** | 6543 | ✅ Funciona. As migrações usam lock por transação exatamente para suportar este modo. |
| Direct connection | 5432 (host `db.....supabase.co`) | ⚠️ Só por IPv6 no plano free. Muitas hospedagens não têm saída IPv6 e a conexão falha. |

**3. Configure no Render:**

```env
DATABASE_URL=postgresql://postgres.<ref>:<senha>@aws-0-<regiao>.pooler.supabase.com:5432/postgres
DATABASE_SSL=true
DATABASE_POOL_MAX=5
```

`DATABASE_POOL_MAX=5` importa: o plano free tem poucas conexões, e cada instância
do app abriria até 10 por padrão.

**4. Opcional — use também o Storage do Supabase para os anexos.** Ele expõe um
endpoint compatível com S3, e o driver `s3` deste projeto é genérico:

```env
STORAGE_DRIVER=s3
S3_ENDPOINT=https://<ref>.supabase.co/storage/v1/s3
S3_REGION=<regiao-do-projeto>
S3_BUCKET=anexos
S3_ACCESS_KEY_ID=<Storage access key>
S3_SECRET_ACCESS_KEY=<Storage secret key>
```

Crie o bucket como **privado** — os downloads passam pela API de qualquer forma.
Este caminho está documentado por compatibilidade de protocolo; ao contrário do
banco, não consegui testá-lo contra um projeto Supabase real.

#### O que pesar antes de escolher

- **Tamanho.** O banco free é bem menor que a cota de arquivos (na data desta
  escrita, 500 MB de banco e 1 GB de storage — confira os limites atuais). Para
  este sistema isso é folgado: o banco guarda só texto e metadados, e os
  binários vão para o storage. 500 MB comportam bem mais de um milhão de
  mensagens.
- **A pausa após 7 dias de inatividade é um risco, não uma conveniência.** Num
  canal de atendimento, ela significa que um cliente que some por uma semana e
  volta encontra o sistema fora do ar até você despausar no painel. Na prática,
  com o serviço no ar e conectado ao banco, o projeto não fica inativo — mas não
  trate isso como garantia. Se você também usar o plano free do Render (que
  dorme após 15 min sem acesso), os dois podem hibernar juntos e aí a pausa
  acontece de verdade.
- **Backup.** No plano free o backup automático é limitado. Se as conversas
  importarem, agende um `pg_dump` seu.

### Opção C — Railway

1. **New Project → Deploy from GitHub**, e adicione um plugin **PostgreSQL**.
2. Build `npm ci && npm run build`, start `npm run start --workspace=server`.
3. Variáveis: `DATABASE_URL` (referência ao plugin), `DATABASE_SSL=true`, `TRUST_PROXY=1`, `APP_URL`,
   os dois segredos, e-mail e storage.
4. Como o disco do Railway é efêmero, use **`STORAGE_DRIVER=s3`**.

### Opção D — VPS com Docker

```bash
docker build -t talk-with-me .
docker run -d --name talk-with-me \
  -p 4000:4000 \
  -e DATABASE_URL="postgresql://..." \
  -e SESSION_SECRET="..." -e PASSWORD_PEPPER="..." \
  -e APP_URL="https://atendimento.seudominio.com" \
  -e NODE_ENV=production -e TRUST_PROXY=1 \
  -v talk_with_me_storage:/app/storage \
  --restart unless-stopped \
  talk-with-me
```

Coloque Nginx ou Caddy na frente com TLS. Para Nginx, **é necessário repassar o upgrade do WebSocket**:

```nginx
location / {
    proxy_pass         http://127.0.0.1:4000;
    proxy_http_version 1.1;
    proxy_set_header   Upgrade $http_upgrade;
    proxy_set_header   Connection "upgrade";
    proxy_set_header   Host $host;
    proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto $scheme;
    proxy_read_timeout 300s;      # não derrube conexões de chat ociosas
    client_max_body_size 30M;     # precisa ser ≥ MAX_UPLOAD_MB
}
```

### Armazenamento de arquivos em produção

Recomendado: **Cloudflare R2** (sem taxa de egress) ou qualquer bucket S3-compatível.

```env
STORAGE_DRIVER=s3
S3_BUCKET=talk-with-me
S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
S3_REGION=auto
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
```

> **O bucket precisa ser privado.** Nada é servido diretamente dele: todo download passa por
> `/api/attachments/:id`, que confere a sessão e a participação na conversa.

---

## 8. Segurança

O princípio que orienta o código: **nada é protegido só porque a tela não mostra.** Toda decisão de
acesso acontece no servidor, e sempre que possível dentro da própria consulta SQL.

### Autenticação

- Senhas com **bcrypt (custo 12)**. Antes do bcrypt a senha passa por um HMAC-SHA256 com o
  `PASSWORD_PEPPER`: isso elimina a truncagem de 72 bytes do bcrypt **e** torna o vazamento da
  tabela `users` insuficiente para um ataque offline, já que o pepper vive fora do banco.
- **Sessões opacas**, não JWT: 32 bytes aleatórios enviados em cookie `HttpOnly` + `Secure` +
  `SameSite=Lax`. No banco guarda-se apenas o **digest HMAC** — um dump não devolve sessões válidas.
- Login com **resposta em tempo constante**: e-mail inexistente também paga o custo de um bcrypt, o
  que impede enumerar contas pelo tempo de resposta.
- **Bloqueio progressivo** persistido em `login_attempts` (sobrevive a restart) somado ao rate limit
  por IP + e-mail.
- Recuperação de senha **sem oráculo**: a resposta é idêntica exista ou não a conta. Token de uso
  único, 1 hora de validade, apenas o digest é armazenado, e concluir o reset **revoga todas as
  sessões**.

### Autorização

- O papel (`role`) é lido do banco **a cada requisição**, nunca do cookie. Perder o papel de
  administrador tem efeito imediato.
- Registro público grava `role` com valor **fixo no SQL** (`'client'`). Não existe caminho pelo qual
  um corpo de requisição vire `admin`.
- Acesso a conversa é **escopo de consulta**, não `if`:

  ```sql
  SELECT ... FROM conversations WHERE id = $1 AND client_id = $2
  ```

  Um cliente pedindo a conversa de outro recebe **404** (não 403) — não confirma nem a existência do id.
- Anexos idem: a query de download exige participação na conversa. Um upload ainda não vinculado a
  mensagem só é visível para quem o enviou.
- `reply_to_id` é validado contra a **mesma conversa**, fechando o vazamento de trechos por citação.
- Bloquear um cliente **revoga as sessões no banco e derruba os sockets abertos** na hora.

### Proteção de dados e entrada

- **SQL injection:** todas as consultas são parametrizadas. Onde a ordenação precisa variar, a chave
  vem de um `enum` Zod mapeado para fragmentos SQL fixos — texto do usuário nunca entra na query.
- **XSS:** o React escapa por padrão e o projeto **não usa `dangerouslySetInnerHTML` em lugar nenhum**.
  A transformação de links tokeniza o texto em nós React com allow-list de protocolo
  (`http`, `https`, `mailto`): `javascript:` e `data:` nunca viram âncora.
- **Validação:** todo corpo, query e parâmetro passa por Zod; os schemas administrativos são
  `.strict()`, então um campo extra é rejeitado em vez de ignorado.
- **CSRF:** double-submit token (cookie legível + header `X-CSRF-Token`) sobre `SameSite=Lax`.
- **Uploads:** allow-list de MIME (sem `image/svg+xml`, sem `text/html`), verificação de
  *magic bytes*, rejeição de conteúdo com marcação executável, nome de arquivo higienizado e chave de
  armazenamento gerada pelo servidor (UUID + extensão da allow-list) — nome enviado pelo usuário
  nunca vira caminho.
- **Download:** `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`,
  `Cross-Origin-Resource-Policy: same-origin` e `Content-Disposition: attachment` para tudo que não
  seja seguro renderizar embutido.
- **Cabeçalhos:** Helmet com CSP restritiva (`script-src 'self'`, `frame-ancestors 'none'`,
  `object-src 'none'`), HSTS em produção.
- **Rate limiting:** global por usuário/IP, com limites específicos para login, cadastro,
  recuperação de senha, envio de mensagens, uploads e busca.
- **WebSocket:** autenticado pelo mesmo cookie de sessão — não há token separado para roubar — a
  permissão é reconferida ao entrar em qualquer sala, e cada socket tem orçamento de eventos: um
  cliente que dispara eventos em massa (para sobrecarregar o banco compartilhado ou floodar o
  operador) é desconectado.
- **Cota de armazenamento por cliente** (`MAX_STORAGE_PER_CLIENT_MB`, padrão 500 MB): o limite por
  arquivo sozinho não impede um cliente de encher o disco um arquivo de cada vez. O administrador é
  isento.
- **Anti-spoofing de identidade:** nomes e campos de texto rejeitam caracteres bidi (RTL/LTR
  override, isolates) e invisíveis (zero-width, BOM) — usados para fazer um nome se parecer com
  outro no painel do operador. Nomes internacionais legítimos (acentos, CJK, cirílico, árabe,
  emoji) passam normalmente.
- **Auditoria:** toda ação administrativa privilegiada é registrada em `audit_log`.

### O que este projeto **não** faz

Vale ser explícito para você decidir com informação:

- **Não há criptografia ponta a ponta.** O administrador precisa ler as mensagens no painel, e a
  busca no servidor depende do texto em claro. Os dados são protegidos em trânsito (TLS) e por
  controle de acesso, não por E2EE.
- **A varredura antivírus de anexos não está incluída.** A allow-list e a checagem de assinatura
  impedem que um arquivo seja *executado no navegador*, mas não analisam o conteúdo. Se seus clientes
  enviarem executáveis ou documentos de origem desconhecida, integre um scanner (ClamAV, VirusTotal)
  no fluxo de upload.
- **A presença é em memória**, adequada para uma instância. Para rodar várias, adicione o adapter
  Redis do Socket.IO (`@socket.io/redis-adapter`) e ative sticky sessions no proxy — o restante do
  código já está preparado, pois toda emissão passa por `realtime/hub.ts`.
- **O rate limiting também é em memória.** Ele zera quando o processo reinicia e não é compartilhado
  entre instâncias. O bloqueio progressivo de login é a exceção: fica em `login_attempts`, no banco,
  justamente por ser o controle que não pode ser contornado com um restart. Para várias instâncias,
  use um store Redis no `express-rate-limit`.
- **Não há varredura de vírus nos anexos** (já dito acima) nem verificação de reputação de links: uma
  URL enviada por um cliente vira um link clicável com `rel="noopener noreferrer nofollow"`, mas o
  destino não é analisado.

---

## 9. Checklist de testes

### Automatizados

```bash
npm test          # 34 testes: senhas, tokens, allow-list de upload, cursores,
                  # escopo de leitura e escape de curingas na busca
npm run typecheck # TypeScript estrito nos dois workspaces
npm run build     # o build precisa passar antes de qualquer deploy
```

### Manuais

**[TESTING.md](TESTING.md)** traz o roteiro completo, passo a passo, para validar
o sistema como administrador e como dois clientes distintos — incluindo os
comandos de console para provar o isolamento entre contas. ~40 minutos.

### Segurança — teste manualmente antes de liberar para clientes reais

Crie **dois clientes** (A e B) e o administrador.

| # | Teste | Resultado esperado |
| --- | --- | --- |
| 1 | Logado como A, chame `GET /api/conversations/<id-do-B>` | **404** |
| 2 | Logado como A, chame `GET /api/conversations/<id-do-B>/messages` | **404** |
| 3 | Logado como A, envie mensagem para a conversa de B | **404** |
| 4 | Copie a URL de um anexo de A e abra logado como B | **404** |
| 5 | Abra a URL de um anexo deslogado | **401** |
| 6 | Logado como cliente, chame `GET /api/admin/clients` | **403** |
| 7 | Cadastre-se enviando `"role":"admin"` no corpo | Conta criada como **cliente** |
| 8 | `PATCH /api/me/profile` com um campo desconhecido | **422** (schema estrito) |
| 9 | POST sem o header `X-CSRF-Token` | **403** |
| 10 | POST com `X-CSRF-Token` errado | **403** |
| 11 | Envie uma mensagem contendo `<script>alert(1)</script>` | Aparece como **texto literal**, sem executar |
| 12 | Envie `javascript:alert(1)` como texto | **Não** vira link clicável |
| 13 | Envie `'; DROP TABLE users; --` | Salvo como texto; tabela intacta |
| 14 | `GET /api/admin/clients?sort=;DROP TABLE users` | **422** (enum recusa) |
| 15 | Renomeie um `.html` para `.png` e envie | **415** — "o conteúdo não corresponde ao tipo" |
| 16 | Tente enviar um `.svg` | **415** |
| 17 | Envie um arquivo acima de `MAX_UPLOAD_MB` | **413** |
| 18 | Erre a senha 12 vezes | Bloqueio temporário (**403**) |
| 19 | Bloqueie um cliente logado em outra aba | A aba é desconectada imediatamente |
| 20 | Tente logar com a conta bloqueada e a senha correta | **403** com o motivo do bloqueio |
| 21 | Troque a senha em um dispositivo | As outras sessões caem; a atual continua |
| 22 | Peça recuperação para um e-mail inexistente | Mesma resposta de um e-mail existente |
| 23 | Use o link de recuperação duas vezes | A segunda falha |
| 24 | Verifique o cookie no DevTools | `HttpOnly` ✓ `SameSite=Lax` ✓ `Secure` (em HTTPS) ✓ |
| 25 | Rode `SELECT password_hash FROM users LIMIT 1` | Hash bcrypt, nunca a senha |

### Funcionamento

| Área | Verificar |
| --- | --- |
| **Cadastro/login** | Criar conta, sair, entrar de novo, recuperar senha ponta a ponta. |
| **Chat em tempo real** | Abra cliente e admin lado a lado: a mensagem aparece nos dois **sem recarregar**. |
| **Status** | Relógio ao enviar → ✓ enviada → ✓✓ visualizada quando o outro lado lê. |
| **Digitando** | "está digitando…" aparece e some sozinho. |
| **Online/offline** | Feche a aba do cliente: o admin vê o status mudar e o "visto há…". |
| **Não lidas** | Conversa com mensagem nova fica em destaque com o contador; zera ao abrir. |
| **Arquivos** | Envie imagem (preview antes do envio, lightbox depois) e PDF (baixa em vez de abrir). |
| **Drag & drop** | Arraste um arquivo para o campo de mensagem. |
| **Compressão** | Envie uma foto grande de celular: chega bem menor que o original. |
| **Responder/copiar/excluir** | As três ações no menu da mensagem. |
| **Busca** | Busca dentro da conversa e busca global no painel administrativo. |
| **Scroll** | Suba no histórico: carrega mais sem "pular"; o botão de novas mensagens aparece. |
| **Reconexão** | Derrube o servidor: aparece "Reconectando…"; suba de novo: reconecta e sincroniza. |
| **Resolver/reabrir** | Resolva pelo painel; o cliente vê o aviso; escrever reabre a conversa. |
| **Ciclo do cliente** | Criar pelo painel (senha temporária de uso único), editar, bloquear, desbloquear, excluir. |
| **Notificações** | Deixe a aba em segundo plano e receba uma mensagem: título com contador + notificação do navegador. |
| **Responsivo** | Celular: lista → conversa em tela cheia, com botão de voltar. Desktop: sidebar + chat. |
| **Temas** | Claro, escuro e "sistema" — sem piscar branco ao recarregar no escuro. |
| **Acessibilidade** | Navegue só pelo teclado; `Esc` fecha modais; foco visível. |

---

## Checklist para lançar

Antes de anunciar para clientes reais:

**Obrigatório**
- [ ] Deploy no ar com URL acessível (seção 7).
- [ ] Domínio próprio apontando para o serviço.
- [ ] E-mail transacional configurado (`MAIL_DRIVER=brevo`) e remetente verificado —
      sem isso a recuperação de senha não funciona. Confirme pelo botão
      **Enviar e-mail de teste** em Configurações, no painel do admin.
- [ ] `STORAGE_DRIVER=s3` (ou volume persistente) para os anexos sobreviverem a deploy.
- [ ] Administrador criado e senha trocada; `ADMIN_PASSWORD` removida do ambiente.
- [ ] Backup do banco ativo.

**Legal (Brasil / LGPD)**
- [ ] Páginas `/privacidade` e `/termos` preenchidas: substitua `[SEU NOME OU EMPRESA]`,
      `[E-MAIL DE CONTATO]`, `[CIDADE/ESTADO]` e `[DATA]` em `web/src/pages/LegalPage.tsx`,
      e revise com apoio jurídico.

**Recomendado**
- [ ] Rodar o [TESTING.md](TESTING.md) já no domínio de produção.
- [ ] Testar em um iPhone real (Safari não foi validado no desenvolvimento).
- [ ] Ativar notificações push (chaves `VAPID_*`) se for usar.
- [ ] Monitoramento de disponibilidade (ex.: UptimeRobot no `/api/health`).

## 10. Operação e manutenção

**Health check:** `GET /api/health` → `{"status":"ok","uptime":<segundos>}`.

**Rotinas automáticas** (a cada 6 horas, dentro do próprio processo):
- remoção de sessões expiradas há mais de 7 dias;
- remoção de anexos enviados mas nunca vinculados a uma mensagem (composer abandonado), com os
  arquivos correspondentes.

**Backup.** O banco é a fonte da verdade para tudo, menos os binários dos anexos. Faça backup do
Postgres (a maioria dos provedores oferece automático) **e** do bucket/volume de arquivos.

**Logs.** JSON estruturado em produção, legível em desenvolvimento. Consultas acima de 250 ms são
registradas como aviso.

**Nova migração:** crie `server/src/db/migrations/002_descricao.sql`. Ela é aplicada
automaticamente no próximo start, uma única vez, dentro de uma transação protegida por um
advisory lock *de transação* — o que a mantém segura tanto num rolling deploy quanto atrás de um
pooler em modo transação (Supabase, Neon, PgBouncer). A contrapartida é que a migração precisa
caber numa transação: nada de `CREATE INDEX CONCURRENTLY`.

**Se você perder o acesso de administrador:** rode `npm run seed:admin` com o mesmo e-mail. A senha é
redefinida e todas as sessões daquele administrador são revogadas.

---

## Licença

MIT.
