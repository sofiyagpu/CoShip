import React, { useEffect, useRef } from 'react';
import {
  Layers,
  BarChart3,
  CheckSquare2,
  CalendarDays,
  Box,
  Sparkles,
  Users,
  FileText,
  X,
  Loader2,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import type { Actor } from '../../../packages/shared/src/index';
import { relativeTime } from './api';
export type Me = Actor & {
  organization: string;
  region: string;
  mode: string;
  runnerEnabled: boolean;
};
export type Notice = { message: string; kind: 'success' | 'error' };
export type Notify = (message: string, kind?: Notice['kind']) => void;
export const iconMap: Record<string, any> = {
  layers: Layers,
  chart: BarChart3,
  check: CheckSquare2,
  calendar: CalendarDays,
  box: Box,
  sparkles: Sparkles,
  users: Users,
  file: FileText,
};
export function Logo() {
  return (
    <div className="brand">
      <img src="/favicon.svg" alt="" />
      <span>
        CoShip<span className="brand-dot">.</span>
      </span>
    </div>
  );
}
export function AppIcon({
  icon,
  color,
  size = 'normal',
}: {
  icon: string;
  color: string;
  size?: string;
}) {
  const Icon = iconMap[icon] || Layers;
  return (
    <span className={`app-icon ${color} ${size}`}>
      <Icon size={size === 'large' ? 27 : 21} strokeWidth={1.7} />
    </span>
  );
}
export function Spinner() {
  return (
    <div className="loading">
      <Loader2 className="spin" size={24} />
      <span>Загрузка…</span>
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
      <Layers size={30} />
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
            <X size={20} />
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
      {notice.kind === 'error' ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}
      <span>{notice.message}</span>
    </div>
  );
}
export function PageHeading({ title, text }: { title: string; text: string }) {
  return (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        <p>{text}</p>
      </div>
    </div>
  );
}
const actionLabels: Record<string, string> = {
  'app.published': 'опубликовал(а) приложение',
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
      <span className="avatar small">{event.avatar || 'CS'}</span>
      <div>
        <p>
          <strong>{event.actor_name || 'CoShip'}</strong>{' '}
          {actionLabels[event.action] || event.action}
        </p>
        <span>{event.app_name || 'Рабочее пространство'}</span>
      </div>
      <time>{relativeTime(event.created_at)}</time>
    </div>
  );
}
