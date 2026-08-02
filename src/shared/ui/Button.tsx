import type { ButtonHTMLAttributes, ReactNode } from 'react';
import clsx from 'clsx';
import type { LucideIcon } from 'lucide-react';

import './button.css';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: LucideIcon;
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger';
  size?: 'small' | 'medium';
  children: ReactNode;
}

export function Button({
  icon: Icon,
  variant = 'secondary',
  size = 'medium',
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button className={clsx('ui-button', `ui-button--${variant}`, `ui-button--${size}`, className)} {...props}>
      {Icon ? <Icon aria-hidden="true" size={size === 'small' ? 15 : 17} strokeWidth={1.8} /> : null}
      <span>{children}</span>
    </button>
  );
}
