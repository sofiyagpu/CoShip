import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  Building2,
  Lock,
  ShieldCheck,
  Loader2,
  CheckCircle2,
  Terminal,
  Upload,
  Copy,
  Users,
  Trash2,
  KeyRound,
} from 'lucide-react';
import { api, post } from './api';
import { Logo, AppIcon, Modal, type Me, type Notify } from './ui';
import type { Actor, AppView } from '../../../packages/shared/src/index';

export function Login({ onLogin }: { onLogin: () => void }) {
  const [config, setConfig] = useState<any>(),
    [users, setUsers] = useState<Actor[]>([]),
    [busy, setBusy] = useState(''),
    [error, setError] = useState('');
  useEffect(() => {
    api('/auth/config')
      .then((c) => {
        setConfig(c);
        if (c.mode !== 'enterprise') api<Actor[]>('/auth/demo-users').then(setUsers);
      })
      .catch((e) => setError(e.message));
  }, []);
  async function login(id: string) {
    setBusy(id);
    try {
      await post('/auth/demo', { user_id: id });
      onLogin();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  }
  return (
    <div className="login-page">
      <div className="login-story">
        <Logo />
        <div className="login-intro">
          <span className="login-kicker">РАБОЧЕЕ ПРОСТРАНСТВО</span>
          <h1>
            Приложения
            <br />
            вашей команды.
          </h1>
          <p>
            Публикуйте внутренние инструменты и выбирайте,
            <br className="desktop-break" /> кому открыть доступ.
          </p>
        </div>
        <div className="login-index">
          <div>
            <span>01</span>
            <strong>Публикация</strong>
            <p>Из редактора или AI-инструмента</p>
          </div>
          <div>
            <span>02</span>
            <strong>Доступ</strong>
            <p>Для сотрудников и отделов</p>
          </div>
          <div>
            <span>03</span>
            <strong>Версии</strong>
            <p>История изменений и откат</p>
          </div>
        </div>
        <span className="login-footer">
          CoShip <span>Внутренние приложения</span>
        </span>
      </div>
      <div className="login-form">
        <div className="login-box">
          <span className="pill">
            <Building2 size={13} /> {config?.organization || 'Рабочее пространство'}
          </span>
          <h2>Войти в CoShip</h2>
          <p>
            {config?.mode === 'enterprise'
              ? 'Используйте аккаунт вашей компании.'
              : 'Выберите аккаунт для локальной демонстрации.'}
          </p>
          {config?.mode === 'enterprise' ? (
            <a className="button primary full" href="/api/auth/oidc">
              <Lock size={16} /> Войти через корпоративный аккаунт
            </a>
          ) : (
            <>
              <div className="demo-note">
                <span className="status-dot" /> Демо-аккаунты
              </div>
              <div className="account-list">
                {users.map((u) => (
                  <button key={u.id} onClick={() => void login(u.id)} disabled={!!busy}>
                    <span className="avatar">{u.avatar}</span>
                    <span>
                      <strong>{u.name}</strong>
                      <small>{u.admin ? 'Администратор пространства' : u.email}</small>
                    </span>
                    {busy === u.id ? (
                      <Loader2 className="spin" size={17} />
                    ) : (
                      <ArrowRight size={17} />
                    )}
                  </button>
                ))}
              </div>
            </>
          )}
          {error && (
            <div className="error-box" role="alert">
              {error}
            </div>
          )}
          <div className="login-security">
            <ShieldCheck size={16} />
            <span>Внешний доступ к приложениям отключён</span>
          </div>
        </div>
      </div>
    </div>
  );
}
export function CreateModal({
  initialTab = 'template',
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => Promise<void>;
  initialTab?: 'template' | 'upload' | 'agent';
}) {
  const [items, setItems] = useState<any[]>([]),
    [selected, setSelected] = useState('tracker'),
    [name, setName] = useState('Командный трекер'),
    [busy, setBusy] = useState(false),
    [tab, setTab] = useState<string>(initialTab),
    [packet, setPacket] = useState<any>(null),
    [error, setError] = useState('');
  useEffect(() => {
    api<any[]>('/templates')
      .then(setItems)
      .catch((e) => setError(e.message));
  }, []);
  async function create() {
    setBusy(true);
    setError('');
    try {
      const result =
        tab === 'template'
          ? await post('/apps/from-template', { template: selected, name })
          : await post('/deployments', { packet, idempotency_key: crypto.randomUUID() });
      if (result.status !== 'active')
        throw new Error(result.error?.message || 'Публикация не завершена');
      await onCreated(result.app_id);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Новое приложение"
      subtitle="Выберите шаблон, загрузите проект или подключите агент."
      onClose={() => !busy && onClose()}
      wide
    >
      <div className="modal-tabs">
        <button className={tab === 'template' ? 'active' : ''} onClick={() => setTab('template')}>
          Из шаблона
        </button>
        <button className={tab === 'upload' ? 'active' : ''} onClick={() => setTab('upload')}>
          Загрузить проект
        </button>
        <button className={tab === 'agent' ? 'active' : ''} onClick={() => setTab('agent')}>
          Из AI-инструмента
        </button>
      </div>
      {tab === 'template' ? (
        <>
          <div className="template-grid">
            {items.map((item) => (
              <button
                key={item.id}
                className={`template ${selected === item.id ? 'selected' : ''}`}
                onClick={() => {
                  setSelected(item.id);
                  setName(item.name);
                }}
              >
                <AppIcon icon={item.icon} color={item.color} />
                <strong>{item.name}</strong>
                <p>{item.description}</p>
                {selected === item.id && <CheckCircle2 size={17} className="template-check" />}
              </button>
            ))}
          </div>
          <label className="field-label">
            Название приложения
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              placeholder="Например, план запуска"
            />
          </label>
          <div className="info-line">
            <Lock size={14} /> Сначала приложение будет доступно только вам.
          </div>
        </>
      ) : tab === 'upload' ? (
        <>
          <label className="upload-box">
            <Upload size={28} />
            <strong>{packet ? packet.manifest?.name : 'Выберите пакет приложения'}</strong>
            <span>JSON-пакет из команды coship pack · до 2 МБ</span>
            <input
              type="file"
              accept=".json"
              onChange={async (e) => {
                try {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  if (file.size > 2097152) throw new Error('Пакет превышает 2 МБ');
                  setPacket(JSON.parse(await file.text()));
                  setError('');
                } catch (e: any) {
                  setError(e.message);
                }
              }}
            />
          </label>
          <p className="muted small-text">
            Пакет содержит манифест и файлы проекта. Перед публикацией CoShip проверит код, секреты
            и политику данных.
          </p>
        </>
      ) : (
        <div className="agent-instructions">
          <Terminal size={30} />
          <h3>Публикация через CLI или MCP</h3>
          <p>Подключите CLI или MCP и попросите агента опубликовать проект.</p>
          <pre>
            coship login
            <br />
            coship init my-app
            <br />
            coship publish my-app
          </pre>
          <p className="small-text muted">
            В репозитории: <code>npm run cli -- …</code>. MCP:{' '}
            <code>coship mcp serve --root /путь/к/проекту</code>.
          </p>
        </div>
      )}
      {error && (
        <div className="error-box" role="alert">
          {error}
        </div>
      )}
      <div className="modal-actions">
        <button className="button secondary" onClick={onClose} disabled={busy}>
          Отмена
        </button>
        {tab !== 'agent' && (
          <button
            className="button primary"
            onClick={() => void create()}
            disabled={busy || (tab === 'template' ? !name.trim() : !packet)}
          >
            {busy ? <Loader2 className="spin" size={16} /> : <ArrowUpRight size={16} />}{' '}
            {busy ? 'Проверяем и публикуем…' : 'Создать и опубликовать'}
          </button>
        )}
      </div>
    </Modal>
  );
}
export function ShareModal({
  app,
  me,
  onClose,
  notify,
  onUpdated,
}: {
  app: AppView;
  me: Me;
  onClose: () => void;
  notify: Notify;
  onUpdated: () => Promise<any>;
}) {
  const [people, setPeople] = useState<any>({ users: [], groups: [] }),
    [grants, setGrants] = useState<any[]>([]),
    [subject, setSubject] = useState(''),
    [role, setRole] = useState('viewer'),
    [builder, setBuilder] = useState(false),
    [busy, setBusy] = useState(false);
  const canManage = app.management_role === 'owner' || me.admin;
  async function load() {
    const [p, g] = await Promise.all([api('/people'), api(`/apps/${app.id}/grants`)]);
    setPeople(p);
    setGrants(g);
  }
  useEffect(() => {
    void load().catch((e) => notify(e.message, 'error'));
  }, [app.id]);
  async function save(grant: any) {
    setBusy(true);
    try {
      await api(`/apps/${app.id}/grants`, { method: 'PUT', body: JSON.stringify(grant) });
      await load();
      await onUpdated();
      notify('Права доступа обновлены');
      setSubject('');
    } catch (e: any) {
      notify(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }
  async function remove(g: any) {
    try {
      await api(`/apps/${app.id}/grants/${g.subject_type}/${encodeURIComponent(g.subject_id)}`, {
        method: 'DELETE',
      });
      await load();
      await onUpdated();
      notify('Доступ отозван');
    } catch (e: any) {
      notify(e.message, 'error');
    }
  }
  return (
    <Modal
      title={`Поделиться «${app.name}»`}
      subtitle="Выберите, кто может открыть приложение и его данные."
      onClose={onClose}
    >
      {canManage && (
        <div className="invite-form">
          <label className="field-label">
            Сотрудник или группа
            <select value={subject} onChange={(e) => setSubject(e.target.value)}>
              <option value="">Выберите получателя</option>
              <optgroup label="Сотрудники">
                {people.users
                  .filter((u: any) => u.active)
                  .map((u: any) => (
                    <option key={u.id} value={`user:${u.id}`}>
                      {u.name}
                    </option>
                  ))}
              </optgroup>
              <optgroup label="Группы">
                {people.groups.map((g: any) => (
                  <option key={g.id} value={`group:${g.id}`}>
                    {g.name}
                  </option>
                ))}
              </optgroup>
            </select>
          </label>
          <div className="invite-row">
            <select
              aria-label="Права на данные"
              value={role}
              onChange={(e) => setRole(e.target.value)}
            >
              <option value="viewer">Может просматривать</option>
              <option value="user">Может изменять данные</option>
            </select>
            <button
              className="button primary"
              disabled={!subject || busy}
              onClick={() => {
                const [type, ...rest] = subject.split(':');
                void save({
                  subject_type: type,
                  subject_id: rest.join(':'),
                  data_role: role,
                  management_role: builder ? 'builder' : null,
                });
              }}
            >
              Добавить
            </button>
          </div>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={builder}
              onChange={(e) => setBuilder(e.target.checked)}
            />{' '}
            Также разрешить публикацию кода
          </label>
        </div>
      )}
      <div className="access-notice">
        <ShieldCheck size={18} />
        <p>
          Получатели увидят <strong>все данные этого приложения</strong>. Доступ к внешним
          корпоративным источникам отдельно не выдаётся.
        </p>
      </div>
      <h4>У кого есть доступ</h4>
      <div className="grant-list">
        <div className="grant-row">
          <span className="avatar">
            {app.owner_name
              .split(' ')
              .map((p) => p[0])
              .slice(0, 2)
              .join('')}
          </span>
          <div>
            <strong>{app.owner_name}</strong>
            <small>Владелец приложения</small>
          </div>
          <span className="muted small-text">Управление</span>
        </div>
        {grants.map((g) => (
          <div className="grant-row" key={`${g.subject_type}:${g.subject_id}`}>
            <span className="avatar">
              {g.subject_type === 'group' ? <Users size={15} /> : g.avatar || 'У'}
            </span>
            <div>
              <strong>{g.name}</strong>
              <small>
                {g.subject_type === 'group'
                  ? 'Группа'
                  : g.management_role
                    ? 'Может публиковать код'
                    : 'Участник'}
              </small>
            </div>
            {canManage ? (
              <>
                <select
                  aria-label={`Права: ${g.name}`}
                  value={g.data_role || 'none'}
                  onChange={(e) =>
                    void save({
                      subject_type: g.subject_type,
                      subject_id: g.subject_id,
                      data_role: e.target.value === 'none' ? null : e.target.value,
                      management_role: g.management_role,
                    })
                  }
                >
                  <option value="viewer">Просмотр</option>
                  <option value="user">Изменение</option>
                  <option value="none">Без данных</option>
                </select>
                <button
                  className="icon-button"
                  onClick={() => void remove(g)}
                  aria-label={`Отозвать доступ: ${g.name}`}
                >
                  <Trash2 size={15} />
                </button>
              </>
            ) : (
              <span className="small-text muted">
                {g.data_role === 'user' ? 'Изменение' : 'Просмотр'}
              </span>
            )}
          </div>
        ))}
      </div>
      <div className="link-access">
        <Lock size={18} />
        <div>
          <strong>Доступ ограничен</strong>
          <p>Ссылка работает только для выбранных сотрудников.</p>
        </div>
      </div>
      <div className="modal-actions">
        <button
          className="button secondary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(`${location.origin}/#app/${app.id}`);
              notify('Корпоративная ссылка скопирована');
            } catch {
              notify('Не удалось скопировать ссылку', 'error');
            }
          }}
        >
          <Copy size={15} />
          Копировать ссылку
        </button>
        <button className="button primary" onClick={onClose}>
          Готово
        </button>
      </div>
    </Modal>
  );
}
export function HelpModal({ onClose, notify }: { onClose: () => void; notify: Notify }) {
  return (
    <Modal
      title="Любой агент. Одна команда."
      subtitle="CoShip отвечает за публикацию, доступ и хранение данных."
      onClose={onClose}
    >
      <div className="help-steps">
        <div>
          <span>1</span>
          <section>
            <h3>Создайте приложение</h3>
            <p>Попросите AI собрать HTML-интерфейс с SDK CoShip. Или начните с готового шаблона.</p>
          </section>
        </div>
        <div>
          <span>2</span>
          <section>
            <h3>Опубликуйте папку</h3>
            <pre>
              npm run cli -- login
              <br />
              npm run cli -- publish ./my-app
            </pre>
          </section>
        </div>
        <div>
          <span>3</span>
          <section>
            <h3>Поделитесь с командой</h3>
            <p>Выберите сотрудников и права. Вход и доступ к данным уже встроены.</p>
          </section>
        </div>
      </div>
      <div className="access-notice">
        <Terminal size={20} />
        <p>
          MCP: <code>npm run mcp -- --root /путь/к/проекту</code>. Добавьте эту команду как
          локальный stdio-сервер в своём агенте.
        </p>
      </div>
      <div className="modal-actions">
        <a className="button secondary" href="/api/docs/sdk" target="_blank" rel="noreferrer">
          Контракт SDK <ArrowUpRight size={14} />
        </a>
        <button className="button primary" onClick={onClose}>
          Понятно
        </button>
      </div>
    </Modal>
  );
}
export function Authorize({
  requestId,
  onDone,
  notify,
}: {
  requestId: string;
  onDone: () => void;
  notify: Notify;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title="Подключить CLI к CoShip?"
      subtitle="Подтвердите запрос, который вы только что запустили в терминале."
      onClose={() => {
        location.hash = '';
      }}
    >
      <div className="access-notice">
        <KeyRound size={22} />
        <p>
          CLI сможет публиковать и скачивать код доступных вам приложений. Он не получит доступ к
          рабочим записям или секретам.
        </p>
      </div>
      <p className="muted small-text">
        Запрос: <code>{requestId}</code>
      </p>
      <div className="modal-actions">
        <button
          className="button secondary"
          onClick={() => {
            location.hash = '';
          }}
        >
          Отмена
        </button>
        <button
          className="button primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await post('/auth/cli/approve', { request_id: requestId });
              onDone();
            } catch (e: any) {
              notify(e.message, 'error');
            } finally {
              setBusy(false);
            }
          }}
        >
          Разрешить публикацию
        </button>
      </div>
    </Modal>
  );
}
