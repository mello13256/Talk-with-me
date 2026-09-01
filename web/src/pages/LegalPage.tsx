import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Logo } from '@/components/layout/Logo';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { ChevronLeftIcon } from '@/components/ui/icons';

/**
 * O ÚNICO trecho que você precisa editar antes de divulgar o canal.
 *
 * Os dois documentos leem tudo daqui, então não é preciso caçar o texto no
 * meio da página. Enquanto qualquer campo continuar entre colchetes, um aviso
 * amarelo aparece no topo das duas páginas — ele some sozinho quando tudo
 * estiver preenchido, de modo que um modelo pela metade não vai ao ar sem que
 * alguém perceba.
 */
const OPERATOR = {
  /** Quem responde legalmente pelo canal: seu nome completo ou a razão social. */
  name: 'Miguel Ososki Barbosa',
  /**
   * CNPJ, para quem atende como empresa. Atendendo como pessoa física, mantenha
   * vazio ('') e a linha some: NÃO publique seu CPF aqui. A página é pública e
   * indexável, a LGPD não exige o documento para identificar o responsável, e um
   * CPF exposto é matéria-prima de fraude.
   */
  document: '',
  /** Para onde vão os pedidos de acesso, correção e exclusão de dados. */
  email: 'josefino13256@gmail.com',
  /** Cidade e estado: usados no foro dos Termos e no contato. */
  city: 'Araucária/PR',
  /** Data da última revisão destes textos, ex.: '10 de março de 2026'. */
  updated: '1º de setembro de 2026',
} as const;

/** Um campo ainda entre colchetes é um campo que ninguém preencheu. */
const PENDING = Object.values(OPERATOR).some((value) => value.startsWith('['));

/**
 * Shared shell for the Privacy Policy and Terms pages.
 */
function LegalShell({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-canvas">
      <header className="sticky top-0 z-30 border-b border-line/70 bg-canvas/85 backdrop-blur-md">
        <nav className="mx-auto flex h-16 max-w-3xl items-center justify-between px-5">
          <Link to="/" className="rounded-lg" aria-label="Início">
            <Logo />
          </Link>
          <ThemeToggle />
        </nav>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-10">
        <Link
          to="/"
          className="mb-6 inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-muted hover:text-ink"
        >
          <ChevronLeftIcon size={16} />
          Voltar
        </Link>

        <h1 className="text-3xl font-semibold tracking-tight text-ink">{title}</h1>
        <p className="mt-2 text-[13px] text-ink-subtle">Última atualização: {updated}</p>

        <div className="prose-legal mt-8 space-y-6 text-[15px] leading-relaxed text-ink-muted">
          {children}
        </div>
      </main>

      <footer className="border-t border-line px-5 py-8">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <Logo compact />
          <div className="flex gap-4 text-[13px] text-ink-subtle">
            <Link to="/privacidade" className="hover:text-ink">Privacidade</Link>
            <Link to="/termos" className="hover:text-ink">Termos</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

function Section({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-[17px] font-semibold text-ink">{heading}</h2>
      {children}
    </section>
  );
}

/** Só aparece enquanto o bloco OPERATOR tiver campos por preencher. */
function DraftBanner() {
  if (!PENDING) return null;
  return (
    <div className="rounded-xl border border-warning/25 bg-warning-soft px-4 py-3 text-[13px] text-warning">
      <strong>Falta preencher.</strong> Edite o bloco <code>OPERATOR</code> no
      topo de <code>web/src/pages/LegalPage.tsx</code>. Este aviso desaparece
      sozinho quando todos os campos estiverem completos. O texto é um ponto de
      partida informado pelo que o sistema realmente faz — não é aconselhamento
      jurídico.
    </div>
  );
}

export function PrivacyPage() {
  return (
    <LegalShell title="Política de Privacidade" updated={OPERATOR.updated}>
      <DraftBanner />

      <p>
        Esta Política descreve como <strong>{OPERATOR.name}</strong> ("nós") trata os dados pessoais
        de quem utiliza este canal de atendimento ("você"), em conformidade com a Lei Geral de
        Proteção de Dados (Lei nº 13.709/2018 — LGPD).
      </p>

      <Section heading="1. Dados que coletamos">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Cadastro:</strong> nome e e-mail, obrigatórios para criar a conta. Telefone,
            empresa e foto de perfil são opcionais e só existem se você os informar.
          </li>
          <li>
            <strong>Conversas:</strong> o conteúdo das mensagens e os arquivos que você envia, com a
            data de envio e a data em que foram lidos.
          </li>
          <li>
            <strong>Anotações do atendimento:</strong> podemos registrar observações internas sobre o
            seu atendimento. Elas não aparecem para você na tela, mas são seus dados pessoais: você
            pode pedir para vê-las ou corrigi-las a qualquer momento, como qualquer outro dado.
          </li>
          <li>
            <strong>Acesso e segurança:</strong> endereço IP e identificação do navegador nas suas
            sessões, tentativas de login (com sucesso ou não) e a data do último acesso. Servem para
            detectar acesso indevido e limitar ataques.
          </li>
          <li>
            <strong>Presença:</strong> se você está com o canal aberto no momento e quando esteve
            online pela última vez, para indicar disponibilidade durante a conversa.
          </li>
          <li>
            <strong>Notificações:</strong> se você autorizar as notificações do navegador, guardamos o
            endereço técnico que o seu navegador fornece para entregá-las. Ele não identifica você
            fora deste serviço e é apagado quando você desativa a permissão.
          </li>
        </ul>
        <p>
          Não coletamos dados de navegação para publicidade, não usamos cookies de rastreamento e não
          há qualquer serviço de análise de terceiros nestas páginas.
        </p>
      </Section>

      <Section heading="2. Cookies">
        <p>
          Usamos apenas dois cookies, ambos estritamente necessários para o funcionamento: um mantém
          você conectado após o login e o outro protege os formulários contra envio forjado por outro
          site. Nenhum dos dois serve para rastrear sua navegação, e eles são apagados quando você sai
          da conta.
        </p>
      </Section>

      <Section heading="3. Para que usamos">
        <p>
          Exclusivamente para prestar o atendimento solicitado, manter o histórico da sua conversa,
          proteger a sua conta e cumprir obrigações legais. Não vendemos seus dados, não os cedemos
          para uso comercial de terceiros e não os usamos para publicidade ou criação de perfis.
        </p>
      </Section>

      <Section heading="4. Base legal">
        <p>
          O tratamento se apoia na execução do atendimento que você solicita (art. 7º, V da LGPD),
          no cumprimento de obrigações legais e no legítimo interesse de manter a segurança do
          serviço — este último limitado aos registros de acesso descritos acima.
        </p>
      </Section>

      <Section heading="5. Quem tem acesso">
        <p>
          Sua conversa e seus arquivos são acessíveis apenas a você e ao administrador do canal.
          <strong> Nenhum outro cliente consegue acessar sua conversa, seus arquivos ou seus dados
          cadastrais</strong> — a separação é imposta pelo próprio sistema, e não apenas pelo que
          cada tela mostra.
        </p>
        <p>
          Contamos com fornecedores de infraestrutura que processam dados em nosso nome e sob
          contrato: hospedagem da aplicação, banco de dados, armazenamento dos arquivos enviados e
          envio de e-mails automáticos (como o de recuperação de senha). Eles não podem usar esses
          dados para finalidade própria.
        </p>
      </Section>

      <Section heading="6. Transferência internacional">
        <p>
          Parte da infraestrutura que utilizamos está hospedada fora do Brasil, atualmente em
          servidores nos Estados Unidos. Isso significa que seus dados podem ser armazenados e
          processados nesses países, sempre por fornecedores contratados que oferecem garantias de
          proteção compatíveis com a LGPD (art. 33). Ao usar o canal, você está ciente dessa
          transferência.
        </p>
      </Section>

      <Section heading="7. Segurança">
        <p>
          As senhas são guardadas apenas de forma cifrada e irreversível — nem nós conseguimos lê-las.
          Toda a comunicação usa conexão criptografada (HTTPS). Os arquivos ficam em armazenamento
          privado e só são entregues após verificação de que quem pede participa daquela conversa.
          Você pode ver suas sessões ativas e encerrá-las a qualquer momento pelo seu perfil.
        </p>
        <p>
          Nenhum sistema é infalível. Se ocorrer um incidente de segurança com risco relevante aos
          seus dados, comunicaremos você e a Autoridade Nacional de Proteção de Dados, como manda a
          lei.
        </p>
      </Section>

      <Section heading="8. Por quanto tempo guardamos">
        <p>
          Mantemos seus dados enquanto a sua conta existir, porque o histórico da conversa é a própria
          finalidade do serviço. Quando a conta é excluída, o cadastro, as mensagens, os anexos e as
          notificações são apagados, inclusive os arquivos no armazenamento — ressalvados registros
          que a lei exija preservar por prazo determinado.
        </p>
      </Section>

      <Section heading="9. Seus direitos">
        <p>
          A LGPD garante que você possa, a qualquer momento: confirmar que tratamos seus dados;
          acessá-los; corrigir dados incompletos ou desatualizados; pedir a exclusão da conta; saber
          com quem os compartilhamos; e obter cópia dos dados que você nos forneceu.
        </p>
        <p>
          Nome, telefone, empresa e foto você mesmo edita no seu perfil. Para os demais pedidos, fale
          conosco pelo próprio canal ou pelo e-mail <strong>{OPERATOR.email}</strong>. Respondemos em
          até 15 dias.
        </p>
      </Section>

      <Section heading="10. Alterações nesta Política">
        <p>
          Se esta Política mudar, atualizamos a data no topo desta página e comunicamos alterações
          relevantes pelo próprio canal de atendimento.
        </p>
      </Section>

      <Section heading="11. Contato">
        <p>
          Responsável pelo tratamento dos dados: <strong>{OPERATOR.name}</strong>
          {OPERATOR.document && <> — {OPERATOR.document}</>} — <strong>{OPERATOR.email}</strong> —{' '}
          {OPERATOR.city}.
        </p>
      </Section>
    </LegalShell>
  );
}

export function TermsPage() {
  return (
    <LegalShell title="Termos de Uso" updated={OPERATOR.updated}>
      <DraftBanner />

      <p>
        Ao criar uma conta e utilizar este canal, você concorda com estes Termos. Se não concordar,
        não utilize o serviço.
      </p>

      <Section heading="1. O que é este serviço">
        <p>
          Um canal privado de atendimento entre você e <strong>{OPERATOR.name}</strong>. Cada cliente
          conversa individualmente com o administrador; não há comunicação entre clientes, nem
          qualquer forma de acesso à conversa de outra pessoa.
        </p>
      </Section>

      <Section heading="2. Sua conta">
        <p>
          Você é responsável por manter a confidencialidade da sua senha e por toda atividade em sua
          conta. Informe dados verdadeiros e mantenha-os atualizados. Avise-nos imediatamente sobre
          qualquer uso não autorizado.
        </p>
      </Section>

      <Section heading="3. Uso aceitável">
        <p>Você concorda em não utilizar o canal para:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>enviar conteúdo ilegal, ofensivo ou que viole direitos de terceiros;</li>
          <li>transmitir vírus, malware ou arquivos maliciosos;</li>
          <li>tentar acessar contas, conversas ou dados de outras pessoas;</li>
          <li>sobrecarregar, testar ou comprometer a segurança do sistema.</li>
        </ul>
        <p>O descumprimento pode levar ao bloqueio ou à exclusão da conta.</p>
      </Section>

      <Section heading="4. Conteúdo que você envia">
        <p>
          Você mantém a responsabilidade pelo conteúdo que envia e declara ter o direito de
          compartilhá-lo. Não nos responsabilizamos por informações incorretas que você forneça nem
          por decisões tomadas com base nas conversas.
        </p>
        <p>
          Há limite de tamanho por arquivo e de espaço total por conta. Envios que ultrapassem esses
          limites são recusados no momento do envio.
        </p>
      </Section>

      <Section heading="5. Disponibilidade">
        <p>
          Empenhamo-nos para manter o serviço disponível, mas ele é fornecido "no estado em que se
          encontra", sem garantia de funcionamento ininterrupto. Podemos suspendê-lo para manutenção.
          Este canal <strong>não substitui atendimento de urgência</strong>: para situações urgentes,
          use um meio de contato direto.
        </p>
      </Section>

      <Section heading="6. Encerramento">
        <p>
          Você pode encerrar sua conta quando quiser, e a exclusão remove suas conversas e arquivos
          conforme a Política de Privacidade. Podemos encerrar ou suspender contas que violem estes
          Termos.
        </p>
      </Section>

      <Section heading="7. Alterações">
        <p>
          Podemos atualizar estes Termos. Mudanças relevantes serão comunicadas pelo próprio canal, e
          a data no topo desta página indica a última revisão.
        </p>
      </Section>

      <Section heading="8. Foro e contato">
        <p>
          Estes Termos são regidos pelas leis brasileiras, com foro em <strong>{OPERATOR.city}</strong>.
          Nada aqui afasta os direitos que o Código de Defesa do Consumidor garante a você. Contato:{' '}
          <strong>{OPERATOR.email}</strong>.
        </p>
      </Section>
    </LegalShell>
  );
}
