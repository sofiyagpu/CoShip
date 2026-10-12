import React, { useEffect, useState } from 'react';
import {
  ArrowRightIcon,
  ArrowUpIcon,
  LinkIcon,
  RepoTemplateIcon,
  TerminalIcon,
  TrashIcon,
  UploadIcon,
} from '@primer/octicons-react';
import { api, post } from './api';
import { WelcomeMotion } from './welcome-motion';
import { Logo, AppMark, Modal, initials, type Me, type Notify } from './ui';
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
    <div className="welcome-page">
      <header className="welcome-header">
        <Logo />
        <nav aria-label="О платформе">
          <a href="#welcome-how">Как работает CoShip</a>
          <a href="#welcome-access">Вход в пространство</a>
        </nav>
        <span className="welcome-mode">
          {config?.mode === 'enterprise' ? config.organization : 'Локальная версия'}
        </span>
        <a className="button secondary" href="#welcome-access">
          Войти
        </a>
      </header>
      <main>
        <section className="welcome-hero" aria-labelledby="welcome-title">
          <div className="welcome-scene" aria-hidden="true">
            <div className="scene-plane scene-left" />
            <div className="scene-plane scene-right" />
            <div className="scene-horizon" />
          </div>
          <WelcomeMotion />
          <div className="welcome-content">
            <div className="welcome-eyebrow">
              <span />
              CoShip / Workspace
            </div>
            <h1 id="welcome-title">Внутренние приложения по описанию</h1>
            <p className="welcome-description">
              Опишите идею — Muse Spark соберёт приложение, а команда доработает его вместе.
            </p>
            <section
              id="welcome-access"
              className="welcome-access"
              aria-labelledby="welcome-access-title"
            >
              <div className="welcome-access-heading">
                <h2 id="welcome-access-title">{config?.organization || 'Рабочее пространство'}</h2>
                <span>{config?.mode === 'enterprise' ? 'Корпоративный вход' : 'Демо'}</span>
              </div>
              {config?.mode === 'enterprise' ? (
                <div className="welcome-enterprise">
                  <p>Войдите с аккаунтом вашей компании.</p>
                  <a className="button primary full" href="/api/auth/oidc">
                    Войти через корпоративный аккаунт
                  </a>
                </div>
              ) : (
                <>
                  <div className="welcome-accounts">
                    {users.map((u) => (
                      <button key={u.id} onClick={() => void login(u.id)} disabled={!!busy}>
                        <span className="avatar">{u.avatar}</span>
                        <span>
                          <strong>{u.name}</strong>
                          <small>{u.admin ? 'Администратор' : 'Участник команды'}</small>
                        </span>
                        {busy === u.id ? (
                          <span className="spinner" />
                        ) : (
                          <ArrowRightIcon size={16} />
                        )}
                      </button>
                    ))}
                  </div>
                </>
              )}
              {!config && !error && (
                <div className="welcome-loading">
                  <span className="spinner" />
                  Загрузка…
                </div>
              )}
              {error && (
                <div className="error-box" role="alert">
                  {error}
                </div>
              )}
            </section>
            <a className="welcome-scroll" href="#welcome-how">
              Как работает CoShip
            </a>
          </div>
        </section>
        <section className="welcome-how" id="welcome-how" aria-label="Возможности CoShip">
          <div>
            <span className="welcome-step">01</span>
            <h2>Опишите</h2>
            <p>Muse Spark соберёт приложение. Или опубликуйте проект через CLI и MCP.</p>
            <code>coship publish .</code>
          </div>
          <div>
            <span className="welcome-step">02</span>
            <h2>Поделитесь</h2>
            <p>Выберите сотрудников и группы — права определяют доступ к данным.</p>
          </div>
          <div>
            <span className="welcome-step">03</span>
            <h2>Дорабатывайте вместе</h2>
            <p>Обсуждение, версии и правки через AI — в одном месте.</p>
          </div>
        </section>
      </main>
      <footer className="welcome-footer">
        <Logo />
      </footer>
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
    <Modal title="Новое приложение" onClose={() => !busy && onClose()} wide>
      <div className="modal-tabs">
        <button className={tab === 'template' ? 'active' : ''} onClick={() => setTab('template')}>
          <RepoTemplateIcon size={16} />
          Шаблон
        </button>
        <button className={tab === 'upload' ? 'active' : ''} onClick={() => setTab('upload')}>
          <UploadIcon size={16} />
          Пакет
        </button>
        <button className={tab === 'agent' ? 'active' : ''} onClick={() => setTab('agent')}>
          <TerminalIcon size={16} />
          CLI и MCP
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
                <AppMark name={item.name} color={item.color} />
                <strong>{item.name}</strong>
                <p>{item.description}</p>
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
        </>
      ) : tab === 'upload' ? (
        <>
          <label className="upload-box">
            <UploadIcon size={24} />
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
        </>
      ) : (
        <div className="agent-instructions">
          <pre>
            coship login
            <br />
            coship init my-app
            <br />
            coship publish my-app
          </pre>
          <p className="hint">
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
            {busy ? 'Публикуем…' : 'Создать и опубликовать'}
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
    <Modal title={`Поделиться «${app.name}»`} onClose={onClose}>
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
      <p className="hint">Получатели увидят все данные этого приложения.</p>
      <h4>У кого есть доступ</h4>
      <div className="grant-list">
        <div className="grant-row">
          <span className="avatar">{initials(app.owner_name)}</span>
          <div>
            <strong>{app.owner_name}</strong>
            <small>Владелец приложения</small>
          </div>
          <span className="muted small-text">Управление</span>
        </div>
        {grants.map((g) => (
          <div className="grant-row" key={`${g.subject_type}:${g.subject_id}`}>
            <span className="avatar">
              {g.subject_type === 'group' ? initials(g.name) : g.avatar || 'У'}
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
                  className="icon-button danger-text"
                  onClick={() => void remove(g)}
                  aria-label={`Отозвать доступ: ${g.name}`}
                >
                  <TrashIcon size={16} />
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
          <LinkIcon size={16} />
          Копировать ссылку
        </button>
        <button className="button primary" onClick={onClose}>
          Готово
        </button>
      </div>
    </Modal>
  );
}
export function HelpModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Как это работает" onClose={onClose}>
      <div className="help-steps">
        <div>
          <span>1</span>
          <section>
            <h3>Опишите приложение</h3>
            <p>Muse Spark соберёт и опубликует приложение.</p>
          </section>
        </div>
        <div>
          <span>2</span>
          <section>
            <h3>Или опубликуйте папку</h3>
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
            <h3>Дорабатывайте вместе</h3>
            <p>Комментарии коллег превращаются в новую версию одним нажатием.</p>
          </section>
        </div>
      </div>
      <p className="hint">
        MCP: <code>npm run mcp -- --root /путь/к/проекту</code>
      </p>
      <div className="modal-actions">
        <a className="button secondary" href="/api/docs/sdk" target="_blank" rel="noreferrer">
          Контракт SDK
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
        <p>
          CLI сможет публиковать и скачивать код доступных вам приложений. Он не получит доступ к
          рабочим записям или секретам.
        </p>
      </div>
      <p className="hint">
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

export function PromptComposer({
  me,
  onCreated,
  onOther,
}: {
  me: Me;
  onCreated: (id: string) => Promise<void>;
  onOther: (tab: 'template' | 'upload' | 'agent') => void;
}) {
  const [prompt, setPrompt] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await post('/apps/generate', { prompt });
      if (result.status !== 'active')
        throw new Error(result.error?.message || 'Публикация не завершена');
      setPrompt('');
      await onCreated(result.app_id);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="composer">
      <h1>Что создадим?</h1>
      <form className="composer-box" onSubmit={submit}>
        <textarea
          id="prompt"
          aria-label="Описание приложения"
          placeholder={
            me.generationEnabled
              ? 'Опишите приложение: учёт заявок на закупку с суммой, статусом и ответственным…'
              : 'Генерация выключена: задайте MUSE_API_KEY'
          }
          maxLength={2000}
          value={prompt}
          disabled={busy || !me.generationEnabled}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey))
              e.currentTarget.form?.requestSubmit();
          }}
        />
        <div className="composer-foot">
          <button type="button" className="chip" onClick={() => onOther('template')}>
            <RepoTemplateIcon size={14} />
            Шаблон
          </button>
          <button type="button" className="chip" onClick={() => onOther('upload')}>
            <UploadIcon size={14} />
            Пакет
          </button>
          <button type="button" className="chip" onClick={() => onOther('agent')}>
            <TerminalIcon size={14} />
            CLI
          </button>
          {busy && <span className="hint composer-status">Muse Spark собирает приложение…</span>}
          <button
            className="send-button"
            aria-label="Создать"
            disabled={busy || !me.generationEnabled || prompt.trim().length < 3}
          >
            {busy ? <span className="spinner" /> : <ArrowUpIcon size={18} />}
          </button>
        </div>
      </form>
      {error && (
        <div className="error-box" role="alert">
          {error}
        </div>
      )}
    </section>
  );
}
