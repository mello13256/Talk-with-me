import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Logo } from '@/components/layout/Logo';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { ChevronLeftIcon } from '@/components/ui/icons';

/**
 * Shared shell for the Privacy Policy and Terms pages.
 *
 * The copy uses [MARCADORES] the operator must replace before publishing —
 * name / company, contact e-mail, and jurisdiction. A visible banner keeps an
 * unfilled template from going live by accident.
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

/** Shown until the operator fills in the [MARCADORES]. */
function DraftBanner() {
  return (
    <div className="rounded-xl border border-warning/25 bg-warning-soft px-4 py-3 text-[13px] text-warning">
      <strong>Modelo a preencher.</strong> Substitua os campos entre colchetes
      (<code>[SEU NOME OU EMPRESA]</code>, <code>[E-MAIL DE CONTATO]</code>,
      <code>[CIDADE/ESTADO]</code>) e revise o texto com apoio jurídico antes de
      divulgar. Este modelo é um ponto de partida, não aconselhamento jurídico.
    </div>
  );
}

export function PrivacyPage() {
  return (
    <LegalShell title="Política de Privacidade" updated="[DATA]">
      <DraftBanner />

      <p>
        Esta Política descreve como <strong>[SEU NOME OU EMPRESA]</strong> ("nós")
        trata os dados pessoais de quem utiliza este canal de atendimento ("você"),
        em conformidade com a Lei Geral de Proteção de Dados (Lei nº 13.709/2018 — LGPD).
      </p>

      <Section heading="1. Dados que coletamos">
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>Cadastro:</strong> nome, e-mail e, se você informar, telefone e empresa.</li>
          <li><strong>Conversas:</strong> as mensagens e os arquivos que você envia neste canal.</li>
          <li><strong>Uso:</strong> data de cadastro, data do último acesso e endereço IP das sessões, para segurança.</li>
        </ul>
      </Section>

      <Section heading="2. Para que usamos">
        <p>
          Usamos seus dados exclusivamente para prestar o atendimento solicitado, manter o histórico
          da sua conversa, garantir a segurança da sua conta e cumprir obrigações legais. Não vendemos
          seus dados nem os usamos para publicidade.
        </p>
      </Section>

      <Section heading="3. Base legal">
        <p>
          O tratamento se apoia na execução do atendimento que você solicita (art. 7º, V da LGPD), no
          seu consentimento ao criar a conta, e no legítimo interesse de manter a segurança do serviço.
        </p>
      </Section>

      <Section heading="4. Com quem compartilhamos">
        <p>
          Seus dados ficam acessíveis apenas a você e ao administrador do canal. Utilizamos provedores
          de infraestrutura (hospedagem, banco de dados, envio de e-mail) que processam os dados em
          nosso nome e sob contrato. <strong>Nenhum outro cliente tem acesso à sua conversa ou aos seus arquivos.</strong>
        </p>
      </Section>

      <Section heading="5. Segurança">
        <p>
          Adotamos medidas técnicas para proteger seus dados: senhas são armazenadas de forma cifrada,
          a comunicação usa conexão segura (HTTPS), os arquivos só são entregues a quem participa da
          conversa e sua sessão pode ser encerrada a qualquer momento.
        </p>
      </Section>

      <Section heading="6. Por quanto tempo guardamos">
        <p>
          Mantemos seus dados enquanto sua conta existir. Ao solicitar a exclusão, a conta, as
          conversas e os arquivos são removidos, ressalvados registros que a lei exija preservar.
        </p>
      </Section>

      <Section heading="7. Seus direitos">
        <p>
          Você pode, a qualquer momento, acessar, corrigir, atualizar ou solicitar a exclusão dos seus
          dados, além de revogar o consentimento. Para exercer esses direitos, fale conosco pelo próprio
          canal ou pelo e-mail <strong>[E-MAIL DE CONTATO]</strong>.
        </p>
      </Section>

      <Section heading="8. Contato">
        <p>
          Responsável pelo tratamento: <strong>[SEU NOME OU EMPRESA]</strong> — <strong>[E-MAIL DE CONTATO]</strong> — <strong>[CIDADE/ESTADO]</strong>.
        </p>
      </Section>
    </LegalShell>
  );
}

export function TermsPage() {
  return (
    <LegalShell title="Termos de Uso" updated="[DATA]">
      <DraftBanner />

      <p>
        Ao criar uma conta e utilizar este canal, você concorda com estes Termos. Se não concordar,
        não utilize o serviço.
      </p>

      <Section heading="1. O que é este serviço">
        <p>
          Um canal privado de atendimento entre você e <strong>[SEU NOME OU EMPRESA]</strong>. Cada
          cliente conversa individualmente com o administrador; não há comunicação entre clientes.
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
          Você mantém a responsabilidade pelo conteúdo que envia. Não nos responsabilizamos por
          informações incorretas ou por decisões tomadas com base nas conversas.
        </p>
      </Section>

      <Section heading="5. Disponibilidade">
        <p>
          Empenhamo-nos para manter o serviço disponível, mas ele é fornecido "no estado em que se
          encontra", sem garantia de funcionamento ininterrupto. Podemos suspendê-lo para manutenção.
        </p>
      </Section>

      <Section heading="6. Encerramento">
        <p>
          Você pode encerrar sua conta quando quiser. Podemos encerrar ou suspender contas que violem
          estes Termos.
        </p>
      </Section>

      <Section heading="7. Alterações">
        <p>
          Podemos atualizar estes Termos. Mudanças relevantes serão comunicadas pelo próprio canal.
        </p>
      </Section>

      <Section heading="8. Foro e contato">
        <p>
          Estes Termos são regidos pelas leis brasileiras, com foro em <strong>[CIDADE/ESTADO]</strong>.
          Contato: <strong>[E-MAIL DE CONTATO]</strong>.
        </p>
      </Section>
    </LegalShell>
  );
}
