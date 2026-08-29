# Talk with me

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
├── render.yaml / fly.toml        # blueprints de deploy
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
| `ALLOW_PUBLIC_REGISTRATION` | `true` | `false` deixa o cadastro apenas por convite do administrador. |
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
| `MAIL_DRIVER` | `console` (só desenvolvimento), `smtp` ou `resend`. Em produção `console` é rejeitado na inicialização. |
| `MAIL_FROM`, `SMTP_*`, `RESEND_API_KEY` | Conforme o driver escolhido. |
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

### Modo recomendado — senha gerada pelo servidor

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

### Modo alternativo — senha própria

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

Qualquer opção abaixo entrega o mesmo resultado: **um serviço + um Postgres**.

### Antes de qualquer deploy

1. Gere `SESSION_SECRET` e `PASSWORD_PEPPER` e guarde-os no gerenciador de segredos do provedor.
2. Defina `APP_URL` com o domínio real e `https://`.
3. Defina `TRUST_PROXY=1` e `DATABASE_SSL=true`.
4. Configure e-mail (`MAIL_DRIVER=smtp` ou `resend`) — sem isso a recuperação de senha não funciona,
   e o servidor recusa subir com `console` em produção.
5. Escolha o armazenamento: `s3` (recomendado) ou `local` **com volume persistente**.

> As migrações rodam sozinhas na inicialização, protegidas por um *advisory lock* do Postgres —
> um rolling deploy com várias instâncias não aplica a mesma migração duas vezes.

### Opção A — Render (mais simples)

O `render.yaml` já descreve o serviço e o banco.

1. Dashboard → **New → Blueprint** → aponte para este repositório.
2. Render cria o web service e o Postgres, e gera `SESSION_SECRET` / `PASSWORD_PEPPER`.
3. Preencha as variáveis marcadas `sync: false`: `APP_URL`, credenciais de S3/R2, e-mail e VAPID.
4. Após o primeiro deploy, abra o **Shell** e crie o administrador (seção 6).

Build: `npm ci && npm run build` · Start: `npm run start --workspace=server` · Health: `/api/health`.

### Opção B — Fly.io (Docker, bom para custo baixo)

```bash
fly launch --no-deploy
fly postgres create --name talk-with-me-db
fly postgres attach talk-with-me-db          # define DATABASE_URL

fly secrets set \
  SESSION_SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")" \
  PASSWORD_PEPPER="$(node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))")" \
  APP_URL="https://talk-with-me.fly.dev" \
  MAIL_DRIVER=resend MAIL_FROM="Talk with me <no-reply@seudominio.com>" RESEND_API_KEY="..."

fly volumes create talk_with_me_data --size 3   # só se STORAGE_DRIVER=local
fly deploy
fly ssh console -C "npm run seed:admin -- --email voce@exemplo.com --name 'Seu Nome'"
```

`min_machines_running = 1` no `fly.toml` é intencional: WebSocket precisa de uma máquina acordada.

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
- **WebSocket:** autenticado pelo mesmo cookie de sessão — não há token separado para roubar — e a
  permissão é reconferida ao entrar em qualquer sala.
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
  Redis do Socket.IO (`@socket.io/redis-adapter`) — o restante do código já está preparado, pois toda
  emissão passa por `realtime/hub.ts`.

---

## 9. Checklist de testes

### Automatizados

```bash
npm test          # 30 testes: senhas, tokens, allow-list de upload, cursores, escopo de leitura
npm run typecheck # TypeScript estrito nos dois workspaces
npm run build     # o build precisa passar antes de qualquer deploy
```

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

**Nova migração:** crie `server/src/db/migrations/002_descricao.sql`. Ela é aplicada automaticamente
no próximo start, uma única vez, dentro de uma transação.

**Se você perder o acesso de administrador:** rode `npm run seed:admin` com o mesmo e-mail. A senha é
redefinida e todas as sessões daquele administrador são revogadas.

---

## Licença

MIT.
