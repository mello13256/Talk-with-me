import { useTheme } from '@/context/ThemeContext';
import { IconButton } from '@/components/ui/Button';
import { MoonIcon, SunIcon } from '@/components/ui/icons';

export function ThemeToggle({ className }: { className?: string }) {
  const { resolved, toggle } = useTheme();
  return (
    <IconButton
      label={resolved === 'dark' ? 'Usar tema claro' : 'Usar tema escuro'}
      onClick={toggle}
      className={className}
    >
      {resolved === 'dark' ? <SunIcon size={18} /> : <MoonIcon size={18} />}
    </IconButton>
  );
}
