import type { ButtonHTMLAttributes } from 'react';
import clsx from 'clsx';
import type { LucideIcon } from 'lucide-react';

import './icon-button.css';

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon;
  label: string;
  active?: boolean;
}

export function IconButton({ icon: Icon, label, active, className, ...props }: IconButtonProps) {
  return (
    <button
      aria-label={label}
      className={clsx('icon-button', active && 'icon-button--active', className)}
      title={label}
      {...props}
    >
      <Icon aria-hidden="true" size={18} strokeWidth={1.8} />
    </button>
  );
}
