import clsx from 'clsx';

import './status-pill.css';

export function StatusPill({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'primary' | 'success' | 'warning' | 'danger';
}) {
  return <span className={clsx('status-pill', `status-pill--${tone}`)}>{children}</span>;
}
