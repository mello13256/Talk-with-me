import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api, ApiError } from '@/lib/api';
import { useToast } from '@/context/ToastContext';
import type { AdminClient, User } from '@/lib/types';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { AlertIcon, CopyIcon } from '@/components/ui/icons';

interface ClientFormModalProps {
  open: boolean;
  /** Editing when a client is supplied; creating otherwise. */
  client: AdminClient | null;
  onClose: () => void;
  onSaved: () => void;
}

export function ClientFormModal({ open, client, onClose, onSaved }: ClientFormModalProps) {
  const toast = useToast();
  const editing = Boolean(client);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [company, setCompany] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(client?.name ?? '');
    setEmail(client?.email ?? '');
    setPhone(client?.phone ?? '');
    setCompany(client?.company ?? '');
    setNotes(client?.notes ?? '');
    setError(null);
    setTemporaryPassword(null);
  }, [open, client]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      if (editing && client) {
        await api.patch<{ client: User }>(`/admin/clients/${client.id}`, {
          name,
          email,
          phone: phone.trim(),
          company: company.trim(),
          notes: notes.trim(),
        });
        toast.success('Cliente atualizado.');
        onSaved();
        onClose();
      } else {
        const data = await api.post<{ client: User; temporaryPassword: string | null }>(
          '/admin/clients',
          {
            name,
            email,
            phone: phone.trim(),
            company: company.trim(),
            notes: notes.trim(),
          },
        );
        onSaved();
        // The generated password is shown once, here, and never again.
        if (data.temporaryPassword) setTemporaryPassword(data.temporaryPassword);
        else onClose();
      }
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Não foi possível salvar.');
    } finally {
      setSaving(false);
    }
  };

  if (temporaryPassword) {
    return (
      <Modal
        open={open}
        onClose={onClose}
        title="Cliente criado"
        description="Envie estes dados de acesso ao cliente por um canal seguro."
        footer={<Button onClick={onClose}>Concluir</Button>}
      >
        <div className="space-y-4">
          <div className="flex items-start gap-2.5 rounded-xl border border-warning/25 bg-warning-soft px-3.5 py-3 text-[13px] text-warning">
            <AlertIcon size={16} className="mt-px shrink-0" />
            <span>
              Esta senha aparece apenas uma vez e não fica armazenada em texto puro. Peça ao cliente
              para trocá-la no primeiro acesso.
            </span>
          </div>

          <div>
            <p className="mb-1.5 text-[13px] font-medium text-ink-muted">E-mail</p>
            <p className="rounded-xl border border-line bg-canvas px-3.5 py-2.5 font-mono text-[13px] text-ink">
              {email}
            </p>
          </div>

          <div>
            <p className="mb-1.5 text-[13px] font-medium text-ink-muted">Senha temporária</p>
            <div className="flex items-center gap-2">
              <p className="min-w-0 flex-1 overflow-x-auto rounded-xl border border-line bg-canvas px-3.5 py-2.5 font-mono text-[13px] text-ink">
                {temporaryPassword}
              </p>
              <Button
                variant="secondary"
                icon={<CopyIcon size={15} />}
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(
                      `E-mail: ${email}\nSenha: ${temporaryPassword}`,
                    );
                    toast.success('Dados copiados.');
                  } catch {
                    toast.error('Não foi possível copiar.');
                  }
                }}
              >
                Copiar
              </Button>
            </div>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'Editar cliente' : 'Novo cliente'}
      description={
        editing
          ? 'Atualize os dados cadastrais deste cliente.'
          : 'Uma senha temporária forte será gerada automaticamente.'
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button
            onClick={(event) => submit(event as unknown as FormEvent)}
            loading={saving}
            disabled={!name.trim() || !email.trim()}
          >
            {editing ? 'Salvar alterações' : 'Criar cliente'}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && (
          <p className="rounded-xl border border-danger/25 bg-danger-soft px-3.5 py-2.5 text-[13px] text-danger">
            {error}
          </p>
        )}

        <Input
          label="Nome"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          data-autofocus
        />
        <Input
          label="E-mail"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Telefone"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="Opcional"
          />
          <Input
            label="Empresa"
            value={company}
            onChange={(event) => setCompany(event.target.value)}
            placeholder="Opcional"
          />
        </div>
        <Textarea
          label="Anotações internas"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          rows={3}
          hint="Visível apenas para você. O cliente nunca vê este campo."
        />
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </Modal>
  );
}
