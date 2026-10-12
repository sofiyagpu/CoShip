import React, { useEffect, useRef } from 'react';
import { AlertFillIcon, CheckCircleFillIcon, XIcon } from '@primer/octicons-react';
import type { Actor } from '../../../packages/shared/src/index';
import { relativeTime } from './api';
export type Me = Actor & {
  organization: string;
  region: string;
  mode: string;
  runnerEnabled: boolean;
  generationEnabled: boolean;
};
export type Notice = { message: string; kind: 'success' | 'error' };
export type Notify = (message: string, kind?: Notice['kind']) => void;
export const initials = (name: string) =>
  name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('');
export function Logo() {
  return (
    <div className="brand">
      <img src="/favicon.svg" alt="" />
      <span>CoShip</span>
    </div>
  );
}
export function AppMark({
  name,
  color,
  size = 'normal',
}: {
  name: string;
  color: string;
  size?: 'normal' | 'large';
}) {
  return (
    <span className={`app-mark ${color} ${size}`} aria-hidden="true">
      {name.trim()[0]?.toUpperCase() || '·'}
    </span>
  );
}
export function Spinner({ label = 'Загрузка…' }: { label?: string }) {
  return (
    <div className="loading">
      <span className="spinner" />
      <span>{label}</span>
    </div>
  );
}
export function Empty({
  title,
  text,
  action,
}: {
  title: string;
  text: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}
export function Modal({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null),
    close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close.current();
      if (e.key === 'Tab') {
        const targets = [
          ...ref.current!.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input,select,textarea,a[href]',
          ),
        ];
        if (!targets.length) return;
        const first = targets[0],
          last = targets[targets.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', key);
    ref.current?.querySelector<HTMLElement>('button')?.focus();
    return () => {
      document.removeEventListener('keydown', key);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`modal ${wide ? 'wide' : ''}`}
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header>
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Закрыть">
            <XIcon size={18} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
export function Toast({ notice }: { notice: Notice }) {
  return (
    <div className={`toast ${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
      {notice.kind === 'error' ? <AlertFillIcon size={16} /> : <CheckCircleFillIcon size={16} />}
      <span>{notice.message}</span>
    </div>
  );
}
export function PageHeading({ title }: { title: string }) {
  return (
    <div className="page-heading">
      <h1>{title}</h1>
    </div>
  );
}
const actionLabels: Record<string, string> = {
  'app.published': 'опубликовал(а) приложение',
  'app.generated': 'изменил(а) приложение через Muse Spark',
  'app.copied': 'создал(а) копию',
  'app.archived': 'отправил(а) в архив',
  'app.restored': 'восстановил(а) приложение',
  'app.rolled_back': 'восстановил(а) версию',
  'access.granted': 'обновил(а) доступ',
  'access.revoked': 'отозвал(а) доступ',
  'comment.added': 'оставил(а) комментарий',
  'app.updated': 'обновил(а) настройки',
  'app.owner_transferred': 'передал(а) владение',
  'user.disabled': 'отключил(а) сотрудника',
  'secret.saved': 'сохранил(а) секрет',
  'secret.deleted': 'удалил(а) секрет',
  'cli.authorized': 'подключил(а) CLI',
  'directory.synced': 'синхронизировал(а) каталог',
  'app.archive_pending': 'подготовлено к архивации',
  'app.auto_archived': 'автоматически архивировано',
};
export function ActivityRow({ event }: { event: any }) {
  return (
    <div className="activity-row">
      <span className="avatar">{event.avatar || 'CS'}</span>
      <p>
        <strong>{event.actor_name || 'CoShip'}</strong> {actionLabels[event.action] || event.action}
        <span className="muted"> · {event.app_name || 'Рабочее пространство'}</span>
      </p>
      <time>{relativeTime(event.created_at)}</time>
    </div>
  );
}
