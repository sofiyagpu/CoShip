import React, { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { AppView } from '../../../packages/shared/src/index';
import { api, post, relativeTime } from './api';
import {
  Logo,
  AppMark,
  Spinner,
  Empty,
  Modal,
  Toast,
  PageHeading,
  ActivityRow,
  initials,
  type Me,
  type Notice,
} from './ui';
import { Login, CreateModal, ShareModal, HelpModal, Authorize, PromptComposer } from './modals';
import { AppDetail, Team, SettingsPage } from './pages';
import './styles.css';

function Root() {
  const [me, setMe] = useState<Me | null>(),
    [apps, setApps] = useState<AppView[]>([]),
    [activity, setActivity] = useState<any[]>([]),
    [page, setPage] = useState('apps'),
    [search, setSearch] = useState(''),
    [filter, setFilter] = useState('all'),
    [layout, setLayout] = useState('grid'),
    [loading, setLoading] = useState(true),
    [notice, setNotice] = useState<Notice | null>(null),
    [create, setCreate] = useState(false),
    [createTab, setCreateTab] = useState<'template' | 'upload' | 'agent'>('template'),
    [share, setShare] = useState<AppView | null>(null),
    [selected, setSelected] = useState<AppView | null>(null),
    [help, setHelp] = useState(false),
    [confirm, setConfirm] = useState<{
      title: string;
      text: string;
      action: () => Promise<void>;
    } | null>(null),
    [busy, setBusy] = useState(false),
    [hash, setHash] = useState(location.hash);
  const notify = useCallback(
    (message: string, kind: Notice['kind'] = 'success') => setNotice({ message, kind }),
    [],
  );
  useEffect(() => {
    if (notice) {
      const t = setTimeout(() => setNotice(null), 5000);
      return () => clearTimeout(t);
    }
  }, [notice]);
  useEffect(() => {
    const h = () => setHash(location.hash);
    window.addEventListener('hashchange', h);
    return () => window.removeEventListener('hashchange', h);
  }, []);
  const refresh = useCallback(async () => {
    const [a, events, user] = await Promise.all([
      api<AppView[]>('/apps'),
      api<any[]>('/activity'),
      api<Me>('/me'),
    ]);
    setMe(user);
    setApps(a);
    setActivity(events);
    return a;
  }, []);
  const loadMe = useCallback(async () => {
    try {
      const user = await api<Me>('/me');
      setMe(user);
      try {
        const loaded = await refresh();
        if (location.hash.startsWith('#app/'))
          setSelected(loaded.find((a) => a.id === location.hash.split('/')[1]) || null);
      } catch (e: any) {
        if (e.code === 'DIRECTORY_STALE') {
          setPage('settings');
          notify(e.message, 'error');
        } else throw e;
      }
    } catch (e: any) {
      if (e.code === 'SIGN_IN_REQUIRED' || e.code === 'SESSION_EXPIRED') setMe(null);
      else {
        notify(e.message, 'error');
        setMe(null);
      }
    } finally {
      setLoading(false);
    }
  }, [notify, refresh]);
  useEffect(() => {
    void loadMe();
  }, [loadMe]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        document.getElementById('global-search')?.focus();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  async function run(fn: () => Promise<any>, message?: string) {
    try {
      const result = await fn();
      if (message) notify(message);
      await refresh();
      return result;
    } catch (e: any) {
      notify(e.message, 'error');
      throw e;
    }
  }
  async function logout() {
    await post('/auth/logout');
    setMe(null);
    setSelected(null);
    setApps([]);
  }
  function navigate(next: string) {
    setPage(next);
    setSelected(null);
    setSearch('');
    setFilter('all');
    location.hash = '';
  }
  function open(app: AppView) {
    setSelected(app);
    setPage('apps');
    location.hash = `app/${app.id}`;
  }
  async function openCreated(id: string, message: string) {
    const all = await refresh();
    const app = all.find((a) => a.id === id);
    if (app) open(app);
    notify(message);
  }
  async function favorite(app: AppView) {
    await run(() => post(`/apps/${app.id}/favorite`, { favorite: !app.favorite })).catch(() => {});
  }
  async function copy(app: AppView) {
    await run(async () => {
      const result = await post(`/apps/${app.id}/copy`);
      if (result.status !== 'active') throw new Error(result.error.message);
      return result;
    }, 'Копия создана с пустой базой данных').catch(() => {});
  }
  function archive(app: AppView) {
    setConfirm({
      title: app.status === 'archived' ? 'Восстановить приложение?' : 'Отправить в архив?',
      text:
        app.status === 'archived'
          ? 'Приложение снова станет доступно участникам. Данные и история сохранятся.'
          : 'Приложение перестанет запускаться. Код, данные и история останутся в вашем пространстве.',
      action: async () => {
        await run(
          () => post(`/apps/${app.id}/archive`, { archived: app.status !== 'archived' }),
          app.status === 'archived' ? 'Приложение восстановлено' : 'Приложение в архиве',
        );
        setSelected(null);
      },
    });
  }
  if (me === undefined || loading) return <Spinner />;
  if (!me)
    return (
      <>
        <Login
          onLogin={() => {
            setLoading(true);
            void loadMe();
          }}
        />
        {notice && <Toast notice={notice} />}
      </>
    );
  const active = apps.filter((a) => a.status !== 'archived'),
    favorites = active.filter((a) => a.favorite),
    archived = apps.filter((a) => a.status === 'archived'),
    shared = active.filter((a) => a.owner_id !== me.id);
  const displayed = apps
    .filter((a) => (page === 'archived' ? a.status === 'archived' : a.status !== 'archived'))
    .filter((a) => page !== 'favorites' || a.favorite)
    .filter((a) => page !== 'shared' || a.owner_id !== me.id)
    .filter(
      (a) => filter === 'all' || (filter === 'mine' ? a.owner_id === me.id : a.people_count > 1),
    )
    .filter((a) =>
      `${a.name} ${a.description} ${a.owner_name}`.toLowerCase().includes(search.toLowerCase()),
    );
  const sections = [
    ['apps', 'Все', active.length],
    ['shared', 'Доступные мне', shared.length],
    ['favorites', 'Избранное', favorites.length],
    ['archived', 'Архив', archived.length],
  ] as const;
  const isApps = sections.some(([id]) => id === page);
  const authorization = hash.startsWith('#authorize/') ? hash.split('/')[1] : null;
  return (
    <div className="workspace">
      <header className="global-header">
        <button
          className="brand-home"
          onClick={() => navigate('apps')}
          aria-label="CoShip — приложения"
        >
          <Logo />
        </button>
        <span className="org-name">{me.organization}</span>
        <nav className="global-nav" aria-label="Основная навигация">
          {(
            [
              ['apps', 'Приложения'],
              ['activity', 'История'],
              ['team', 'Команда'],
              ['settings', 'Настройки'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => navigate(id)}
              className={(id === 'apps' ? isApps : page === id) ? 'active' : ''}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="header-actions">
          <button className="text-button" onClick={() => setHelp(true)}>
            Помощь
          </button>
          <span
            className="avatar"
            title={`${me.name} · ${me.admin ? 'Администратор' : 'Участник'}`}
          >
            {me.avatar}
          </span>
          <button className="text-button" onClick={() => void logout()}>
            Выйти
          </button>
        </div>
      </header>
      <main className="main">
        {selected ? (
          <AppDetail
            app={selected}
            me={me}
            onBack={() => navigate('apps')}
            onShare={() => setShare(selected)}
            onCopy={() => void copy(selected)}
            onArchive={() => archive(selected)}
            notify={notify}
            onRefresh={async () => {
              const a = await refresh();
              setSelected(a.find((x) => x.id === selected.id) || null);
            }}
          />
        ) : (
          <div className="page-content">
            {isApps ? (
              <>
                <PromptComposer
                  me={me}
                  onCreated={(id) => openCreated(id, 'Muse Spark собрал и опубликовал приложение')}
                  onOther={(tab) => {
                    setCreateTab(tab);
                    setCreate(true);
                  }}
                />
                <div className="section-bar">
                  <nav className="tabs" aria-label="Разделы приложений">
                    {sections.map(([id, label, count]) => (
                      <button
                        key={id}
                        className={page === id ? 'active' : ''}
                        onClick={() => navigate(id)}
                      >
                        {id === 'apps' ? 'Все приложения' : label}
                        <small>{count}</small>
                      </button>
                    ))}
                  </nav>
                  <div className="toolbar">
                    <input
                      id="global-search"
                      className="search"
                      placeholder="Найти приложение…"
                      aria-label="Поиск приложений"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                    <select
                      aria-label="Фильтр приложений"
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                    >
                      <option value="all">Все владельцы</option>
                      <option value="mine">Только мои</option>
                      <option value="team">С общим доступом</option>
                    </select>
                    <div className="segmented">
                      <button
                        className={layout === 'grid' ? 'selected' : ''}
                        onClick={() => setLayout('grid')}
                      >
                        Сетка
                      </button>
                      <button
                        className={layout === 'list' ? 'selected' : ''}
                        onClick={() => setLayout('list')}
                      >
                        Список
                      </button>
                    </div>
                  </div>
                </div>
                <div className={`app-grid ${layout === 'list' ? 'list-view' : ''}`}>
                  {displayed.map((app) => (
                    <AppCard
                      key={app.id}
                      app={app}
                      me={me}
                      onOpen={() => open(app)}
                      onFavorite={() => void favorite(app)}
                      onShare={() => setShare(app)}
                      onCopy={() => void copy(app)}
                      onArchive={() => archive(app)}
                    />
                  ))}
                </div>
                {!displayed.length && (
                  <Empty
                    title={search ? 'Приложения не найдены' : 'Здесь пока пусто'}
                    text={
                      search
                        ? 'Попробуйте другое название или сбросьте фильтр.'
                        : 'Опишите приложение выше или выберите другой раздел.'
                    }
                  />
                )}
                <footer className="page-footer">
                  <span>
                    CoShip · {me.organization} ·{' '}
                    {me.mode === 'enterprise' ? me.region : 'Локальная версия'}
                  </span>
                  <button
                    className="text-button"
                    onClick={() => {
                      setCreateTab('agent');
                      setCreate(true);
                    }}
                  >
                    Публикация из редактора: <code>coship publish .</code>
                  </button>
                </footer>
              </>
            ) : page === 'activity' ? (
              <>
                <PageHeading
                  title="История"
                  text="Публикации, запросы к Muse Spark и изменения доступа."
                />
                <div className="surface list-surface">
                  {activity.map((e) => (
                    <ActivityRow key={e.id} event={e} />
                  ))}
                  {!activity.length && (
                    <Empty
                      title="История пока пуста"
                      text="Начните с создания первого приложения."
                    />
                  )}
                </div>
              </>
            ) : page === 'team' ? (
              <Team me={me} notify={notify} confirm={setConfirm} onRefresh={refresh} />
            ) : (
              <SettingsPage me={me} notify={notify} />
            )}
          </div>
        )}
      </main>
      {notice && <Toast notice={notice} />}
      {create && (
        <CreateModal
          initialTab={createTab}
          onClose={() => setCreate(false)}
          onCreated={async (id) => {
            setCreate(false);
            await openCreated(id, 'Приложение опубликовано');
          }}
        />
      )}
      {share && (
        <ShareModal
          app={share}
          me={me}
          onClose={() => setShare(null)}
          notify={notify}
          onUpdated={refresh}
        />
      )}
      {help && <HelpModal onClose={() => setHelp(false)} />}
      {confirm && (
        <Modal title={confirm.title} onClose={() => !busy && setConfirm(null)}>
          <p className="modal-copy">{confirm.text}</p>
          <div className="modal-actions">
            <button className="button secondary" onClick={() => setConfirm(null)} disabled={busy}>
              Отмена
            </button>
            <button
              className="button primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await confirm.action();
                  setConfirm(null);
                } catch (e: any) {
                  notify(e.message, 'error');
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? 'Выполняем…' : 'Подтвердить'}
            </button>
          </div>
        </Modal>
      )}
      {authorization && (
        <Authorize
          requestId={authorization}
          onDone={() => {
            location.hash = '';
            notify('CLI подключён к рабочему пространству');
          }}
          notify={notify}
        />
      )}
    </div>
  );
}
function AppCard({
  app,
  me,
  onOpen,
  onFavorite,
  onShare,
  onCopy,
  onArchive,
}: {
  app: AppView;
  me: Me;
  onOpen: () => void;
  onFavorite: () => void;
  onShare: () => void;
  onCopy: () => void;
  onArchive: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const canManage = app.management_role === 'owner' || me.admin;
  return (
    <article className="app-card">
      <button className="card-main" onClick={onOpen}>
        <AppMark name={app.name} color={app.color} />
        <span>
          <h3>{app.name}</h3>
          <p>{app.description || 'Без описания'}</p>
          <small>
            {app.status === 'archived'
              ? 'В архиве'
              : app.status === 'archive_pending'
                ? 'Ожидает архива'
                : `Версия ${app.release_count}`}{' '}
            · {relativeTime(app.updated_at)}
          </small>
        </span>
      </button>
      <div className="card-footer">
        <span className="owner">
          <span className="avatar small">{initials(app.owner_name)}</span>
          {app.owner_name}
        </span>
        <span className="card-actions">
          <button
            className={`chip ${app.favorite ? 'on' : ''}`}
            onClick={onFavorite}
            aria-pressed={app.favorite}
            aria-label={
              app.favorite ? `Убрать ${app.name} из избранного` : `В избранное: ${app.name}`
            }
          >
            {app.favorite ? 'В избранном' : 'В избранное'}
          </button>
          <span className="menu-anchor">
            <button
              className="chip"
              onClick={() => setMenu(!menu)}
              aria-label={`Действия: ${app.name}`}
              aria-expanded={menu}
            >
              Ещё
            </button>
            {menu && (
              <>
                <button
                  className="menu-dismiss"
                  aria-label="Закрыть меню"
                  onClick={() => setMenu(false)}
                />
                <div className="dropdown">
                  <button
                    onClick={() => {
                      setMenu(false);
                      onShare();
                    }}
                  >
                    Управление доступом
                  </button>
                  {app.management_role && (
                    <button
                      onClick={() => {
                        setMenu(false);
                        onCopy();
                      }}
                    >
                      Сделать копию
                    </button>
                  )}
                  {canManage && (
                    <button
                      onClick={() => {
                        setMenu(false);
                        onArchive();
                      }}
                    >
                      {app.status === 'archived' ? 'Восстановить' : 'В архив'}
                    </button>
                  )}
                </div>
              </>
            )}
          </span>
        </span>
      </div>
    </article>
  );
}
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
