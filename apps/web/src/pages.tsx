import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ArrowLeftIcon,
  BrowserIcon,
  CommentIcon,
  CopyIcon,
  DownloadIcon,
  GearIcon,
  HistoryIcon,
  PeopleIcon,
  SparkleFillIcon,
  TrashIcon,
} from '@primer/octicons-react';
import type { AppView } from '../../../packages/shared/src/index';
import { api, post, formatDate } from './api';
import { AppMark, Empty, PageHeading, Spinner, initials, type Me, type Notify } from './ui';

export function AppDetail({
  app,
  me,
  onBack,
  onShare,
  onCopy,
  onArchive,
  notify,
  onRefresh,
}: {
  app: AppView;
  me: Me;
  onBack: () => void;
  onShare: () => void;
  onCopy: () => void;
  onArchive: () => void;
  notify: Notify;
  onRefresh: () => Promise<void>;
}) {
  const [tab, setTab] = useState('app'),
    [launch, setLaunch] = useState<{
      html: string;
      release_id: string;
      bridge_nonce: string;
    } | null>(null),
    [error, setError] = useState(''),
    [releases, setReleases] = useState<any[]>([]),
    [comments, setComments] = useState<any[]>([]),
    [comment, setComment] = useState(''),
    [busy, setBusy] = useState(false),
    [generating, setGenerating] = useState(false),
    [mode, setMode] = useState<'comment' | 'prompt'>('comment'),
    [name, setName] = useState(app.name),
    [description, setDescription] = useState(app.description),
    [people, setPeople] = useState<any[]>([]),
    [owner, setOwner] = useState(app.owner_id),
    [backup, setBackup] = useState((app as any).backup_owner_id || '');
  const frame = useRef<HTMLIFrameElement>(null),
    channel = useRef<MessagePort | null>(null),
    generation = useRef(0);
  useEffect(() => {
    setName(app.name);
    setDescription(app.description);
    setOwner(app.owner_id);
  }, [app.id, app.name, app.description, app.owner_id]);
  useEffect(() => {
    let cancelled = false;
    setError('');
    setLaunch(null);
    if (app.data_role && app.status !== 'archived')
      api(`/apps/${app.id}/launch`)
        .then((r) => {
          if (!cancelled) setLaunch(r);
        })
        .catch((e) => {
          if (!cancelled) setError(e.message);
        });
    return () => {
      cancelled = true;
      generation.current++;
      channel.current?.close();
    };
  }, [app.id, app.active_release_id, app.status, app.data_role]);
  async function loadDetails() {
    const r = await api<any[]>(`/apps/${app.id}/releases`);
    setReleases(r);
    if (app.data_role && app.status !== 'archived')
      setComments(await api(`/apps/${app.id}/comments`));
  }
  useEffect(() => {
    void loadDetails().catch((e) => notify(e.message, 'error'));
    api('/people')
      .then((p) => setPeople(p.users))
      .catch(() => {});
  }, [app.id, app.active_release_id]);
  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;
  // ponytail: 15s polling keeps collaborators in sync; switch to SSE if load grows.
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.hidden) return;
      void loadDetails().catch(() => {});
      void refreshRef.current().catch(() => {});
    }, 15000);
    return () => clearInterval(timer);
  }, [app.id, app.active_release_id, app.data_role, app.status]);
  useLayoutEffect(() => {
    if (!launch || tab !== 'app') return;
    const current = ++generation.current;
    let inFlight = 0,
      connected = false;
    function receive(event: MessageEvent) {
      if (
        connected ||
        event.source !== frame.current?.contentWindow ||
        event.origin !== 'null' ||
        event.data?.type !== 'coship:ready' ||
        event.data?.nonce !== launch!.bridge_nonce ||
        !event.ports[0]
      )
        return;
      connected = true;
      const port = event.ports[0];
      channel.current = port;
      port.onmessage = async (event) => {
        const message = event.data;
        if (
          !message ||
          typeof message.id !== 'string' ||
          message.id.length > 64 ||
          !['data', 'function'].includes(message.method) ||
          current !== generation.current ||
          inFlight >= 16
        )
          return;
        try {
          if (JSON.stringify(message).length > 70000) return;
        } catch {
          return;
        }
        inFlight++;
        try {
          const path =
            message.method === 'data'
              ? `/apps/${app.id}/data`
              : `/apps/${app.id}/functions/${encodeURIComponent(String(message.args?.name || ''))}`;
          const payload =
            message.method === 'data'
              ? { ...message.args, release_id: launch!.release_id }
              : { release_id: launch!.release_id, input: message.args?.input };
          const result = await post(path, payload);
          if (current === generation.current) port.postMessage({ id: message.id, result });
        } catch (e: any) {
          if (current === generation.current)
            port.postMessage({
              id: message.id,
              error: { code: e.code || 'REQUEST_FAILED', message: e.message },
            });
        } finally {
          inFlight--;
        }
      };
      port.postMessage({ type: 'coship:connected' });
    }
    window.addEventListener('message', receive);
    return () => {
      generation.current++;
      window.removeEventListener('message', receive);
      channel.current?.close();
      channel.current = null;
    };
  }, [launch, app.id, tab]);
  async function addComment() {
    setBusy(true);
    try {
      await post(`/apps/${app.id}/comments`, { body: comment });
      setComment('');
      await loadDetails();
    } catch (e: any) {
      notify(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }
  async function source() {
    try {
      const packet = await api(`/apps/${app.id}/source`);
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(packet, null, 2)], { type: 'application/json' }),
      );
      const a = document.createElement('a');
      a.href = url;
      a.download = `coship-${app.id}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      notify(e.message, 'error');
    }
  }
  const canBuild = !!app.management_role && me.generationEnabled && app.status !== 'archived';
  const versionOf = (releaseId: string) => releases.find((r) => r.id === releaseId)?.version;
  async function generate(prompt: string) {
    setGenerating(true);
    try {
      const result = await post(`/apps/${app.id}/generate`, {
        prompt,
        expected_release_id: app.active_release_id,
      });
      if (result.status !== 'active')
        throw new Error(result.error?.message || 'Публикация не завершена');
      setComment('');
      await onRefresh();
      await loadDetails();
      notify('Muse Spark опубликовал новую версию');
    } catch (e: any) {
      notify(e.message, 'error');
    } finally {
      setGenerating(false);
    }
  }
  return (
    <div className="detail-page">
      <button className="back-link" onClick={onBack}>
        <ArrowLeftIcon size={16} />
        Все приложения
      </button>
      <div className="detail-heading">
        <AppMark name={app.name} color={app.color} size="large" />
        <div>
          <h1>{app.name}</h1>
          <p className="meta">
            {app.owner_name} · v{releases[0]?.version ?? app.release_count} · {app.record_count}{' '}
            записей
          </p>
        </div>
        <div className="detail-actions">
          {app.management_role && (
            <button className="button secondary" onClick={onCopy}>
              <CopyIcon size={16} />
              Копия
            </button>
          )}
          <button className="button primary" onClick={onShare}>
            <PeopleIcon size={16} />
            Поделиться
          </button>
        </div>
      </div>
      <nav className="tabs" aria-label="Разделы приложения">
        {(
          [
            ['app', BrowserIcon, 'Приложение'],
            ['versions', HistoryIcon, 'Версии'],
            ['settings', GearIcon, 'Настройки'],
          ] as const
        ).map(([id, Icon, label]) => (
          <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
            <Icon size={16} />
            {label}
            {id === 'versions' && <small>{releases.length}</small>}
          </button>
        ))}
      </nav>
      {tab === 'app' ? (
        <div className="studio">
          <div className="app-frame-wrap">
            {app.status === 'archived' ? (
              <Empty
                title="Приложение в архиве"
                text="Код и данные сохранены. Восстановите приложение, чтобы продолжить."
                action={
                  (app.management_role === 'owner' || me.admin) && (
                    <button className="button primary" onClick={onArchive}>
                      Восстановить
                    </button>
                  )
                }
              />
            ) : !app.data_role ? (
              <Empty
                title="Нет доступа к данным"
                text="Право управления приложением не даёт автоматического доступа к его данным."
                action={
                  <button className="button secondary" onClick={onShare}>
                    Посмотреть права
                  </button>
                }
              />
            ) : error ? (
              <div className="error-box" role="alert">
                {error}
              </div>
            ) : launch ? (
              <iframe
                ref={frame}
                title={app.name}
                srcDoc={launch.html}
                sandbox="allow-scripts allow-forms"
                referrerPolicy="no-referrer"
              />
            ) : (
              <Spinner />
            )}
          </div>
          <aside className="surface thread" aria-label="Совместная работа">
            <header>
              <h3>Обсуждение</h3>
            </header>
            {!app.data_role || app.status === 'archived' ? (
              <p className="hint">Нужен доступ к действующему приложению.</p>
            ) : (
              <>
                <div className="thread-list">
                  {comments.map((c) => (
                    <div className={`message ${c.kind}`} key={c.id}>
                      <span className="avatar">{c.avatar}</span>
                      <div>
                        <div className="message-meta">
                          <strong>{c.name}</strong>
                          {c.kind === 'prompt' && (
                            <span className="tag">
                              <SparkleFillIcon size={12} />
                              AI
                              {versionOf(c.release_id) ? ` · v${versionOf(c.release_id)}` : ''}
                            </span>
                          )}
                          <time>{formatDate(c.created_at)}</time>
                        </div>
                        <p>{c.body}</p>
                        {canBuild && c.kind !== 'prompt' && (
                          <button
                            className="text-button"
                            disabled={generating}
                            onClick={() => void generate(c.body)}
                          >
                            <SparkleFillIcon size={12} />
                            Воплотить
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                  {!comments.length && !generating && <p className="hint">Пока тихо.</p>}
                  {generating && (
                    <div className="message pending">
                      <span className="spinner" />
                      <p>Собираем новую версию…</p>
                    </div>
                  )}
                </div>
                <form
                  className="thread-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (mode === 'prompt') void generate(comment);
                    else void addComment();
                  }}
                >
                  {canBuild && (
                    <div className="segmented">
                      <button
                        type="button"
                        className={mode === 'comment' ? 'selected' : ''}
                        onClick={() => setMode('comment')}
                      >
                        <CommentIcon size={14} />
                        Комментарий
                      </button>
                      <button
                        type="button"
                        className={mode === 'prompt' ? 'selected' : ''}
                        onClick={() => setMode('prompt')}
                      >
                        <SparkleFillIcon size={14} />
                        AI-правка
                      </button>
                    </div>
                  )}
                  <textarea
                    aria-label={mode === 'prompt' ? 'Запрос к Muse Spark' : 'Комментарий'}
                    placeholder={
                      mode === 'prompt'
                        ? 'Например: добавь фильтр по статусу и поле «срок»'
                        : 'Что можно улучшить?'
                    }
                    maxLength={2000}
                    value={comment}
                    disabled={generating}
                    onChange={(e) => setComment(e.target.value)}
                  />
                  <button
                    className="button primary"
                    disabled={
                      busy || generating || comment.trim().length < (mode === 'prompt' ? 3 : 1)
                    }
                  >
                    {mode === 'prompt' ? 'Изменить' : 'Отправить'}
                  </button>
                </form>
              </>
            )}
          </aside>
        </div>
      ) : tab === 'versions' ? (
        <div className="surface list-surface">
          <div className="section-title">
            <h3>История публикаций</h3>
            {app.management_role && (
              <button className="button secondary" onClick={() => void source()}>
                <DownloadIcon size={16} />
                Скачать код
              </button>
            )}
          </div>
          {releases.map((r) => {
            const prompt = comments.find((c) => c.kind === 'prompt' && c.release_id === r.id);
            return (
              <div className="release-row" key={r.id}>
                <span className="version">v{r.version}</span>
                <div>
                  <strong>
                    {r.author} · {formatDate(r.created_at)}
                    {r.id === app.active_release_id && <span className="tag">Текущая</span>}
                  </strong>
                  {prompt && <p>«{prompt.body}»</p>}
                  <code>sha256:{r.digest.slice(0, 20)}…</code>
                </div>
                {r.id !== app.active_release_id && app.management_role && (
                  <button
                    className="button secondary"
                    onClick={async () => {
                      try {
                        await post(`/apps/${app.id}/rollback`, {
                          release_id: r.id,
                          expected_release_id: app.active_release_id,
                        });
                        await onRefresh();
                        notify('Версия восстановлена');
                      } catch (e: any) {
                        notify(e.message, 'error');
                      }
                    }}
                  >
                    Восстановить
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="settings-grid">
          <section className="surface settings-card">
            <h3>О приложении</h3>
            <label className="field-label">
              Название
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                disabled={app.management_role !== 'owner' && !me.admin}
              />
            </label>
            <label className="field-label">
              Описание
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={300}
                disabled={app.management_role !== 'owner' && !me.admin}
              />
            </label>
            {(app.management_role === 'owner' || me.admin) && (
              <>
                <button
                  className="button primary"
                  onClick={async () => {
                    try {
                      await api(`/apps/${app.id}`, {
                        method: 'PATCH',
                        body: JSON.stringify({ name, description }),
                      });
                      await onRefresh();
                      notify('Изменения сохранены');
                    } catch (e: any) {
                      notify(e.message, 'error');
                    }
                  }}
                >
                  Сохранить изменения
                </button>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={app.pinned}
                    onChange={async (e) => {
                      try {
                        await api(`/apps/${app.id}`, {
                          method: 'PATCH',
                          body: JSON.stringify({ pinned: e.target.checked }),
                        });
                        await onRefresh();
                      } catch (e: any) {
                        notify(e.message, 'error');
                      }
                    }}
                  />
                  Не архивировать автоматически
                </label>
              </>
            )}
          </section>
          <section className="surface settings-card">
            <h3>Ответственность и доступ</h3>
            {app.management_role === 'owner' || me.admin ? (
              <>
                <label className="field-label">
                  Владелец
                  <select value={owner} onChange={(e) => setOwner(e.target.value)}>
                    {people
                      .filter((p) => p.active)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                  </select>
                </label>
                <button
                  className="button secondary"
                  disabled={owner === app.owner_id}
                  onClick={async () => {
                    try {
                      await post(`/apps/${app.id}/owner`, { owner_id: owner });
                      await onRefresh();
                      notify('Владелец изменён');
                    } catch (e: any) {
                      notify(e.message, 'error');
                    }
                  }}
                >
                  Передать владение
                </button>
                <label className="field-label">
                  Заместитель на случай отключения
                  <select value={backup} onChange={(e) => setBackup(e.target.value)}>
                    <option value="">Администратор компании</option>
                    {people
                      .filter((p) => p.active && p.id !== app.owner_id)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                  </select>
                </label>
                <button
                  className="button secondary"
                  onClick={async () => {
                    try {
                      await api(`/apps/${app.id}`, {
                        method: 'PATCH',
                        body: JSON.stringify({ backup_owner_id: backup || null }),
                      });
                      await onRefresh();
                      notify('Заместитель сохранён');
                    } catch (e: any) {
                      notify(e.message, 'error');
                    }
                  }}
                >
                  Сохранить заместителя
                </button>
                <div className="danger-section">
                  <button className="button danger" onClick={onArchive}>
                    {app.status === 'archived' ? 'Восстановить приложение' : 'Отправить в архив'}
                  </button>
                </div>
              </>
            ) : (
              <button className="button secondary" onClick={onShare}>
                Посмотреть участников
              </button>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
export function Team({
  me,
  notify,
  confirm,
  onRefresh,
}: {
  me: Me;
  notify: Notify;
  confirm: (c: any) => void;
  onRefresh: () => Promise<any>;
}) {
  const [people, setPeople] = useState<any>({ users: [], groups: [] });
  const load = () => api('/people').then(setPeople);
  useEffect(() => {
    void load().catch((e) => notify(e.message, 'error'));
  }, []);
  return (
    <>
      <PageHeading title="Команда" />
      <div className="team-summary">
        {people.groups.map((g: any) => (
          <div className="surface group-card" key={g.id}>
            <span className="avatar">{initials(g.name)}</span>
            <div>
              <strong>{g.name}</strong>
              <p>{g.members} участников</p>
            </div>
          </div>
        ))}
      </div>
      <section className="surface team-table">
        <div className="section-title">
          <h3>
            Участники <span className="muted">{people.users.length}</span>
          </h3>
          <span className="pill">
            {me.mode === 'enterprise' ? 'Корпоративный каталог' : 'Демонстрационная команда'}
          </span>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Сотрудник</th>
                <th>Роль</th>
                <th>Статус</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {people.users.map((u: any) => (
                <tr key={u.id}>
                  <td>
                    <div className="person-cell">
                      <span className="avatar">{u.avatar}</span>
                      <div>
                        <strong>
                          {u.name}
                          {u.id === me.id ? ' (вы)' : ''}
                        </strong>
                        <small>{u.email}</small>
                      </div>
                    </div>
                  </td>
                  <td>
                    {me.admin && u.active ? (
                      <select
                        aria-label={`Роль: ${u.name}`}
                        value={u.admin ? 'admin' : 'member'}
                        onChange={(e) => {
                          const promote = e.target.value === 'admin';
                          confirm({
                            title: promote
                              ? 'Назначить администратора?'
                              : 'Снять права администратора?',
                            text: `Изменение затронет управление всем пространством для ${u.name}. Права на бизнес-данные останутся отдельными.`,
                            action: async () => {
                              await api(`/admin/users/${u.id}/role`, {
                                method: 'PATCH',
                                body: JSON.stringify({ admin: promote }),
                              });
                              await load();
                              await onRefresh();
                              notify('Роль обновлена');
                            },
                          });
                        }}
                      >
                        <option value="admin">Администратор</option>
                        <option value="member">Участник</option>
                      </select>
                    ) : u.admin ? (
                      'Администратор'
                    ) : (
                      'Участник'
                    )}
                  </td>
                  <td>
                    <span className={`status-tag ${u.active ? '' : 'archived'}`}>
                      <i />
                      {u.active ? 'Активен' : 'Отключён'}
                    </span>
                  </td>
                  <td>
                    {me.admin && u.active && u.id !== me.id && (
                      <button
                        className="text-button danger-text"
                        onClick={() =>
                          confirm({
                            title: `Отключить ${u.name}?`,
                            text: 'Сессии будут отозваны. Приложения перейдут заместителю или администратору без передачи прав на данные.',
                            action: async () => {
                              await post(`/admin/users/${u.id}/disable`);
                              await load();
                              await onRefresh();
                              notify('Сотрудник отключён');
                            },
                          })
                        }
                      >
                        Отключить
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
export function SettingsPage({ me, notify }: { me: Me; notify: Notify }) {
  const [status, setStatus] = useState<any>(),
    [secrets, setSecrets] = useState<any[]>([]),
    [name, setName] = useState(''),
    [value, setValue] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const load = async () => {
    const [s, k] = await Promise.all([api('/admin/status'), api('/admin/secrets')]);
    setStatus(s);
    setSecrets(k);
  };
  useEffect(() => {
    if (me.admin) void load().catch((e) => setError(e.message));
  }, [me.admin]);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await post('/admin/secrets', { name, value });
      setValue('');
      setName('');
      await load();
      notify('Секрет зашифрован и сохранён');
    } catch (e: any) {
      notify(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeading title="Настройки" />
      {!me.admin ? (
        <Empty
          title="Настройки доступны администратору"
          text="Для изменения корпоративных настроек обратитесь к владельцу пространства."
        />
      ) : error ? (
        <div className="error-box" role="alert">
          {error}
        </div>
      ) : (
        <div className="settings-grid">
          <section className="surface settings-card">
            <div className="section-title">
              <h3>Контур компании</h3>
            </div>
            <dl className="settings-list">
              <div>
                <dt>Организация</dt>
                <dd>{me.organization}</dd>
              </div>
              <div>
                <dt>Режим</dt>
                <dd>{me.mode === 'enterprise' ? 'Корпоративный' : 'Локальная разработка'}</dd>
              </div>
              <div>
                <dt>Регион установки</dt>
                <dd>{me.region}</dd>
              </div>
              <div>
                <dt>Хранилище</dt>
                <dd>{status?.database || '…'}</dd>
              </div>
              <div>
                <dt>Публичные ссылки</dt>
                <dd>Отключены</dd>
              </div>
              <div>
                <dt>Серверные функции</dt>
                <dd>{status?.runtime || '…'}</dd>
              </div>
              <div>
                <dt>Каталог</dt>
                <dd>
                  {status?.directory_synced_at
                    ? formatDate(status.directory_synced_at)
                    : me.mode === 'enterprise'
                      ? 'Нужна синхронизация'
                      : 'Демонстрационные аккаунты'}
                </dd>
              </div>
            </dl>
            <button
              className="button secondary"
              onClick={async () => {
                try {
                  await post('/admin/lifecycle/run');
                  notify('Политика архивирования применена');
                } catch (e: any) {
                  notify(e.message, 'error');
                }
              }}
            >
              Проверить неиспользуемые приложения
            </button>
          </section>
          <section className="surface settings-card">
            <div className="section-title">
              <h3>Хранилище секретов</h3>
            </div>
            <p className="hint">Значения шифруются и не возвращаются через API.</p>
            <form onSubmit={save}>
              <label className="field-label">
                Название
                <input
                  placeholder="SERVICE_API_KEY"
                  pattern="[A-Z][A-Z0-9_]{1,63}"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </label>
              <label className="field-label">
                Значение
                <input
                  type="password"
                  autoComplete="new-password"
                  placeholder="Введите секрет"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  required
                />
              </label>
              <button className="button primary" disabled={busy || !name || !value}>
                {busy ? 'Сохраняем…' : 'Сохранить секрет'}
              </button>
            </form>
            <div className="secret-list">
              {secrets.map((s) => (
                <div key={s.id}>
                  <code>{s.name}</code>
                  <span>••••••••</span>
                  <button
                    className="icon-button danger-text"
                    aria-label={`Удалить секрет ${s.name}`}
                    onClick={async () => {
                      try {
                        await api(`/admin/secrets/${s.id}`, { method: 'DELETE' });
                        await load();
                        notify('Секрет удалён');
                      } catch (e: any) {
                        notify(e.message, 'error');
                      }
                    }}
                  >
                    <TrashIcon size={16} />
                  </button>
                </div>
              ))}
              {!secrets.length && <p className="small-text muted">Секретов пока нет.</p>}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
