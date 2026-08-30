# Checklist de validação manual

Roteiro para validar o sistema localmente antes de liberar para clientes reais.
Executado do zero leva ~40 minutos.

## Preparação

```bash
npm install
npm run db:up
cp .env.example .env
# preencha SESSION_SECRET e PASSWORD_PEPPER com valores aleatórios:
node -e "
const fs=require('fs'), c=require('crypto');
let e=fs.readFileSync('.env','utf8');
e=e.replace(/^SESSION_SECRET=.*\$/m,'SESSION_SECRET='+c.randomBytes(32).toString('base64url'));
e=e.replace(/^PASSWORD_PEPPER=.*\$/m,'PASSWORD_PEPPER='+c.randomBytes(24).toString('base64url'));
fs.writeFileSync('.env',e);"

npm run migrate
npm run seed:admin -- --email admin@teste.local --name "Atendimento"   # anote a senha
npm run dev
```

Abra **http://localhost:5173**.

**Você vai precisar de três sessões simultâneas**, porque a sessão é por perfil de
navegador:

| Papel | Onde abrir |
| --- | --- |
| **ADMIN** | Janela normal do Chrome |
| **CLIENTE A** | Janela anônima do Chrome |
| **CLIENTE B** | Outro navegador (Firefox) ou um segundo perfil do Chrome |

> Duas abas anônimas do mesmo Chrome **compartilham a sessão** — não servem como
> dois clientes diferentes.

Os links de recuperação de senha aparecem no **terminal do servidor**
(`MAIL_DRIVER=console`).

---

## Bloco 1 — Contas e acesso

| # | Ação | Esperado |
| --- | --- | --- |
| 1.1 | Abra `/` deslogado | Landing carrega, botões **Entrar** e **Criar conta** |
| 1.2 | CLIENTE A: criar conta com senha `123` | Botão continua desabilitado; requisitos em vermelho |
| 1.3 | CLIENTE A: criar conta com `Cliente#A2026` | Entra direto no chat, com a mensagem de boas-vindas |
| 1.4 | CLIENTE B: criar conta com o **mesmo e-mail** de A | Erro "Já existe uma conta com este e-mail" |
| 1.5 | CLIENTE B: criar conta própria | Entra no chat, **conversa vazia** (não vê nada de A) |
| 1.6 | ADMIN: entrar com o e-mail do `seed:admin` | Cai em `/admin`, não em `/chat` |
| 1.7 | CLIENTE A: acessar `/admin` na barra de endereços | Redirecionado para `/chat` |
| 1.8 | ADMIN: acessar `/chat` | Redirecionado para `/admin` |
| 1.9 | CLIENTE A: sair pelo menu | Volta ao login; `/chat` não é mais acessível |

## Bloco 2 — Isolamento entre clientes (o mais importante)

Pegue o **id da conversa de A**: com A logado, DevTools → Network → a chamada
`conversations/me` → copie `conversation.id`.

| # | Ação | Esperado |
| --- | --- | --- |
| 2.1 | CLIENTE B, no console: `fetch('/api/conversations/<ID-DE-A>').then(r=>r.status)` | **404** |
| 2.2 | CLIENTE B: `fetch('/api/conversations/<ID-DE-A>/messages').then(r=>r.status)` | **404** |
| 2.3 | CLIENTE B: POST em `/api/conversations/<ID-DE-A>/messages` | **404** |
| 2.4 | CLIENTE A: enviar uma imagem; copiar a URL do anexo (`/api/attachments/...`) | — |
| 2.5 | CLIENTE B: abrir essa URL | **404** |
| 2.6 | Abrir a mesma URL em janela deslogada | **401** |
| 2.7 | ADMIN: abrir a mesma URL | Imagem carrega |
| 2.8 | CLIENTE B: `fetch('/api/admin/clients').then(r=>r.status)` | **403** |
| 2.9 | CLIENTE B: `fetch('/api/admin/stats').then(r=>r.status)` | **403** |

> **404 e não 403 é intencional** em 2.1–2.3: um cliente não deve nem confirmar
> que aquele id existe.

## Bloco 3 — Chat em tempo real

Deixe **CLIENTE A** e **ADMIN** lado a lado na tela.

| # | Ação | Esperado |
| --- | --- | --- |
| 3.1 | A envia "Bom dia, preciso de ajuda" | Aparece no painel do ADMIN **sem recarregar** |
| 3.2 | Observe a lista lateral do ADMIN | A conversa sobe ao topo, em negrito, com badge de não lida |
| 3.3 | ADMIN abre a conversa | O badge zera |
| 3.4 | Olhe a mensagem de A | Passa de ✓ (enviada) para ✓✓ (visualizada) |
| 3.5 | ADMIN começa a digitar | A vê "está digitando…" |
| 3.6 | ADMIN para de digitar sem enviar | O indicador some em poucos segundos |
| 3.7 | ADMIN responde | Chega instantaneamente em A |
| 3.8 | A fecha a aba | ADMIN vê o status mudar para offline / "visto há…" |
| 3.9 | A envia `https://exemplo.com/pedido/1` | Vira link clicável, abre em nova aba |
| 3.10 | A envia `<script>alert(1)</script>` | Aparece como **texto literal**, sem alerta |
| 3.11 | A envia `javascript:alert(1)` | **Não** vira link |
| 3.12 | A envia um texto de 3000 caracteres | Quebra corretamente, sem estourar a largura |
| 3.13 | A cola 20000 caracteres no campo | Corta em 8000, sem erro |

## Bloco 4 — Arquivos

| # | Ação | Esperado |
| --- | --- | --- |
| 4.1 | A anexa uma foto grande (>3 MB) do celular | Miniatura aparece; o arquivo enviado fica bem menor |
| 4.2 | A arrasta um arquivo para o campo de mensagem | Área tracejada "Solte os arquivos" |
| 4.3 | A envia a imagem e clica nela | Abre em tela cheia; `Esc` fecha; setas navegam |
| 4.4 | A envia um PDF | Aparece como cartão com nome e tamanho; clicar baixa |
| 4.5 | Renomeie um `.html` para `.png` e tente enviar | Erro **"o conteúdo do arquivo não corresponde ao tipo"** |
| 4.6 | Tente enviar um `.svg` | Erro de tipo não permitido |
| 4.7 | Tente enviar um arquivo > 25 MB | Erro de tamanho |
| 4.8 | A remove um anexo antes de enviar (X na miniatura) | Some da lista; não é enviado |

## Bloco 5 — Painel administrativo

| # | Ação | Esperado |
| --- | --- | --- |
| 5.1 | ADMIN: buscar pelo nome de A | Lista filtra |
| 5.2 | ADMIN: buscar por `%` | **Nenhum** resultado (não retorna todos) |
| 5.3 | ADMIN: filtro "Não respondidas" | Só conversas com mensagem pendente |
| 5.4 | ADMIN: abrir "Dados do cliente" | E-mail, cadastro, último contato, contagem de mensagens |
| 5.5 | ADMIN: editar e salvar uma anotação interna | Salva; **CLIENTE A não vê a anotação em lugar nenhum** |
| 5.6 | ADMIN: "Marcar como resolvida" | A vê o aviso verde de atendimento concluído |
| 5.7 | CLIENTE A: escrever de novo | A conversa **reabre** sozinha nos dois lados |
| 5.8 | ADMIN: criar cliente novo pelo botão + | Mostra a senha temporária **uma vez** |
| 5.9 | Entrar com esse cliente usando a senha temporária | Funciona |
| 5.10 | ADMIN: bloquear esse cliente (com motivo) | A aba dele **cai na hora** |
| 5.11 | Tentar logar com a conta bloqueada e a senha **correta** | **403** com o motivo do bloqueio |
| 5.12 | ADMIN: desbloquear | Consegue entrar de novo |
| 5.13 | ADMIN: excluir o cliente (confirmar no diálogo) | Some da lista; a conversa some junto |
| 5.14 | ADMIN: Configurações → busca global por uma palavra | Encontra a mensagem e leva à conversa |
| 5.15 | ADMIN: Configurações → Atividade administrativa | Registra bloqueio, exclusão, resolução |

## Bloco 6 — Erros, conexão e sessão

| # | Ação | Esperado |
| --- | --- | --- |
| 6.1 | Pare o servidor (`Ctrl+C`) com o chat aberto | Após ~3 s: faixa "Reconectando…" |
| 6.2 | Suba o servidor de novo | Reconecta sozinho, sem recarregar a página |
| 6.3 | Enquanto offline, envie uma mensagem | Fica marcada como falha, com "Tentar novamente" |
| 6.4 | Volte a conexão e clique em "Tentar novamente" | Envia **uma única vez** (sem duplicar) |
| 6.5 | Suba muito no histórico | Carrega mensagens antigas sem "pular" a rolagem |
| 6.6 | Com o chat rolado para cima, receba uma mensagem nova | Botão "novas mensagens" com contador |
| 6.7 | Perfil → Sessões ativas | Lista os dispositivos, marcando o atual |
| 6.8 | Perfil → Encerrar outras sessões | As outras janelas caem |
| 6.9 | Perfil → Alterar senha | Outros dispositivos caem; o atual continua |
| 6.10 | Login → "Esqueci minha senha" | Link aparece no terminal do servidor |
| 6.11 | Usar o link e definir nova senha | Funciona; **todas** as sessões caem |
| 6.12 | Usar o **mesmo link** de novo | "Link inválido ou expirado" |
| 6.13 | Pedir recuperação para e-mail inexistente | **Mesma** resposta de um e-mail válido |
| 6.14 | Errar a senha 12 vezes seguidas | Bloqueio temporário (403), mesmo com a senha certa depois |

## Bloco 7 — Segurança de sessão e CSRF

Execute no console do navegador, logado como CLIENTE A.

| # | Comando | Esperado |
| --- | --- | --- |
| 7.1 | `document.cookie` | Mostra `twm_csrf`, **não** mostra `twm_session` (é HttpOnly) |
| 7.2 | DevTools → Application → Cookies → `twm_session` | `HttpOnly` ✓, `SameSite=Lax` ✓ |
| 7.3 | `fetch('/api/conversations/<SEU-ID>/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"body":"x"}'}).then(r=>r.status)` | **403** (sem header CSRF) |
| 7.4 | Repetir com `'X-CSRF-Token':'errado'` | **403** |
| 7.5 | `fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'email=a@b.c&password=x'}).then(r=>r.status)` | **422** (só JSON é aceito) |
| 7.6 | Cadastrar enviando `"role":"admin"` no corpo | Conta criada como **cliente** |
| 7.7 | `fetch('/api/me/profile',{method:'PATCH',...,body:'{"role":"admin"}'})` | **422** (campo desconhecido) |
| 7.8 | `fetch('/api/admin/clients?sort=;DROP TABLE users')` | **422** |
| 7.9 | Enviar mensagem com `'; DROP TABLE users; --` | Salva como texto; rode `\dt` no psql: tabelas intactas |

Verificação no banco:

```bash
docker compose exec db psql -U talkwithme -d talkwithme \
  -c "select email, left(password_hash,7) as hash from users limit 3;"
# hash deve começar com $2a$ / $2b$ — nunca a senha em texto
```

## Bloco 8 — Responsividade e aparência

| # | Ação | Esperado |
| --- | --- | --- |
| 8.1 | DevTools → modo dispositivo → iPhone, como ADMIN | Vê a **lista**; ao tocar num cliente, o chat ocupa a tela toda |
| 8.2 | Botão voltar no chat mobile | Retorna à lista |
| 8.3 | Como CLIENTE no celular | Chat em tela cheia, campo fixo embaixo |
| 8.4 | Alternar tema claro / escuro / sistema | Muda na hora e persiste ao recarregar |
| 8.5 | Recarregar no tema escuro | **Sem** flash branco |
| 8.6 | Navegar só pelo teclado (Tab) | Foco sempre visível; `Esc` fecha modais |
| 8.7 | Zoom de 200% no navegador | Nada quebra nem sai da tela |

## Bloco 9 — Notificações

| # | Ação | Esperado |
| --- | --- | --- |
| 9.1 | CLIENTE A em segundo plano; ADMIN envia mensagem | Título da aba mostra `(1) Talk with me` |
| 9.2 | Abrir o sino de notificações | Item novo, em destaque |
| 9.3 | Clicar na notificação | Marca como lida e leva à conversa |
| 9.4 | ADMIN envia 5 mensagens seguidas | **Uma** notificação por conversa, não cinco |
| 9.5 | Perfil → ativar notificações do navegador | Pede permissão (só funciona com `VAPID_*` configurado) |

## Bloco 10 — Build de produção

```bash
npm run typecheck   # sem erros
npm test            # 34 testes passando
npm run build       # compila os dois workspaces
```

Rodar como produção roda:

```bash
NODE_ENV=production MAIL_DRIVER=console ALLOW_INSECURE_MAIL=true \
  APP_URL=http://localhost:4000 npm start
# abra http://localhost:4000 — a mesma porta serve API e interface
```

| # | Verificação | Esperado |
| --- | --- | --- |
| 10.1 | `curl -I http://localhost:4000/` | `Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options: DENY` |
| 10.2 | Log da inicialização | Avisa sobre `MAIL_DRIVER=console` e `STORAGE_DRIVER=local` |
| 10.3 | `Ctrl+C` | Encerra em menos de 1 s, sem travar |
| 10.4 | Subir com `SESSION_SECRET` curto | Recusa iniciar e diz qual variável está errada |

---

## O que fazer se algo falhar

Anote **o número do item**, o que apareceu na tela, e o que apareceu no terminal
do servidor. Os erros do servidor saem em JSON com `"level":"error"`, então:

```bash
npm run dev 2>&1 | grep -i error
```
