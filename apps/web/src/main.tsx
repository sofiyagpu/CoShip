import React, { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowUpRight,
  ArrowRight,
  Plus,
  Search,
  ChevronDown,
  ChevronRight,
  LayoutGrid,
  Star,
  Users,
  Archive,
  Activity,
  Settings,
  HelpCircle,
  LogOut,
  Grid2X2,
  List,
  MoreHorizontal,
  Check,
  Lock,
  ShieldCheck,
  Terminal,
  Copy,
  Loader2,
  Sparkles,
  Code2,
  CheckCircle2,
} from 'lucide-react';
import type { AppView } from '../../../packages/shared/src/index';
import { api, post, relativeTime } from './api';
import {
  Logo,
  AppIcon,
  Spinner,
  Empty,
  Modal,
  Toast,
  PageHeading,
  ActivityRow,
  type Me,
  type Notice,
} from './ui';
import { Login, CreateModal, ShareModal, HelpModal, Authorize } from './modals';
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
    archived = apps.filter((a) => a.status === 'archived');
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
  const titles: Record<string, string> = {
    apps: 'Приложения',
    favorites: 'Избранное',
    shared: 'Доступные мне',
    archived: 'Архив приложений',
    activity: 'История',
    team: 'Команда',
    settings: 'Настройки',
  };
  const nav = [
    ['apps', LayoutGrid, 'Приложения', active.length],
    ['shared', Users, 'Доступные мне', null],
    ['favorites', Star, 'Избранное', favorites.length],
    ['archived', Archive, 'Архив', archived.length],
  ] as const;
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
        <span className="header-divider" />
        <button className="organization-button" onClick={() => navigate('settings')}>
          {me.organization}
          <ChevronDown size={14} />
        </button>
        <nav className="global-nav" aria-label="Основная навигация">
          {(
            [
              ['apps', 'Приложения'],
              ['activity', 'История'],
              ['team', 'Команда'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => navigate(id)}
              className={
                (
                  id === 'apps'
                    ? ['apps', 'shared', 'favorites', 'archived'].includes(page)
                    : page === id
                )
                  ? 'active'
                  : ''
              }
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="header-actions">
          <button className="icon-button" onClick={() => setHelp(true)} aria-label="Помощь">
            <HelpCircle size={19} />
          </button>
          <button
            className={`icon-button ${page === 'settings' ? 'active' : ''}`}
            onClick={() => navigate('settings')}
            aria-label="Настройки"
          >
            <Settings size={19} />
          </button>
          <span
            className="avatar"
            title={`${me.name} · ${me.admin ? 'Администратор' : 'Участник'}`}
          >
            {me.avatar}
          </span>
          <button className="icon-button" onClick={() => void logout()} aria-label="Выйти">
            <LogOut size={17} />
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
            {['apps', 'shared', 'favorites', 'archived'].includes(page) ? (
              <>
                <div className="page-heading">
                  <div>
                    <div className="workspace-context">
                      <span className="status-dot" />
                      {me.organization}
                      <span className="context-separator">/</span>
                      {me.mode === 'enterprise' ? me.region : 'Локальная версия'}
                    </div>
                    <h1>
                      {titles[page]}
                      <span className="heading-count">
                        {page === 'archived'
                          ? archived.length
                          : page === 'favorites'
                            ? favorites.length
                            : page === 'shared'
                              ? active.filter((a) => a.owner_id !== me.id).length
                              : active.length}
                      </span>
                    </h1>
                    <p>
                      {page === 'archived'
                        ? 'Архивные приложения можно восстановить с сохранением данных.'
                        : 'Открывайте приложения, управляйте доступом и публикуйте обновления.'}
                    </p>
                  </div>
                  <div className="heading-actions">
                    <button
                      className="button secondary"
                      onClick={() => {
                        setCreateTab('upload');
                        setCreate(true);
                      }}
                    >
                      <ArrowUpRight size={17} />
                      Загрузить проект
                    </button>
                    <button
                      className="button primary"
                      onClick={() => {
                        setCreateTab('template');
                        setCreate(true);
                      }}
                    >
                      <Plus size={17} />
                      Создать приложение
                    </button>
                  </div>
                </div>
                <div className="collection-nav" role="navigation" aria-label="Разделы приложений">
                  {nav.map(([id, Icon, label, count]) => (
                    <button
                      key={id}
                      className={page === id ? 'active' : ''}
                      onClick={() => navigate(id)}
                    >
                      <Icon size={16} />
                      <span>{id === 'apps' ? 'Все приложения' : label}</span>
                      {count !== null && <small>{count}</small>}
                    </button>
                  ))}
                </div>
                <div className="toolbar">
                  <label className="owner-filter">
                    <span>Владелец</span>
                    <select
                      aria-label="Фильтр приложений"
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                    >
                      <option value="all">Все</option>
                      <option value="mine">Только мои</option>
                      <option value="team">С общим доступом</option>
                    </select>
                  </label>
                  <div className="toolbar-right">
                    <label className="search-box">
                      <Search size={16} />
                      <input
                        id="global-search"
                        placeholder="Найти приложение…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                      <kbd>⌘ K</kbd>
                    </label>
                    <div className="layout-switch">
                      <button
                        className={layout === 'grid' ? 'selected' : ''}
                        onClick={() => setLayout('grid')}
                        aria-label="Показать карточками"
                      >
                        <Grid2X2 size={16} />
                      </button>
                      <button
                        className={layout === 'list' ? 'selected' : ''}
                        onClick={() => setLayout('list')}
                        aria-label="Показать списком"
                      >
                        <List size={17} />
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
                    title={search ? 'Приложения не найдены' : 'Нет приложений'}
                    text={
                      search
                        ? 'Попробуйте другое название или сбросьте фильтр.'
                        : 'Создайте приложение или выберите другой раздел.'
                    }
                    action={
                      <button className="button secondary" onClick={() => setCreate(true)}>
                        <Plus size={16} />
                        Создать приложение
                      </button>
                    }
                  />
                )}
                {page === 'apps' && (
                  <section className="workspace-tools">
                    <div>
                      <Terminal size={19} />
                      <div>
                        <h3>Публикация из вашего редактора</h3>
                        <p>CLI и MCP для подключения AI-инструментов.</p>
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        setCreateTab('agent');
                        setCreate(true);
                      }}
                    >
                      <code>coship publish .</code>
                      <ArrowUpRight size={17} />
                    </button>
                  </section>
                )}
                <footer className="page-footer">
                  <span>CoShip / {me.organization}</span>
                  <button onClick={() => setHelp(true)}>
                    Документация <ArrowUpRight size={13} />
                  </button>
                </footer>
              </>
            ) : page === 'activity' ? (
              <>
                <PageHeading
                  title="История"
                  text="Публикации и изменения доступа в рабочем пространстве."
                />
                <div className="surface activity-full">
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
      {notice && <Toast notice={notice} />}{' '}
      {create && (
        <CreateModal
          initialTab={createTab}
          onClose={() => setCreate(false)}
          onCreated={async (id) => {
            setCreate(false);
            const all = await refresh();
            const app = all.find((a) => a.id === id);
            if (app) open(app);
            notify('Приложение опубликовано');
          }}
        />
      )}{' '}
      {share && (
        <ShareModal
          app={share}
          me={me}
          onClose={() => setShare(null)}
          notify={notify}
          onUpdated={refresh}
        />
      )}{' '}
      {help && <HelpModal onClose={() => setHelp(false)} notify={notify} />}{' '}
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
              {busy ? <Loader2 size={16} className="spin" /> : <Check size={16} />}Подтвердить
            </button>
          </div>
        </Modal>
      )}{' '}
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
      <div className="card-top">
        <AppIcon icon={app.icon} color={app.color} />
        <div className="card-actions">
          <button
            className={`icon-button favorite ${app.favorite ? 'is-favorite' : ''}`}
            onClick={onFavorite}
            aria-label={
              app.favorite ? `Убрать ${app.name} из избранного` : `В избранное: ${app.name}`
            }
          >
            <Star size={16} fill={app.favorite ? 'currentColor' : 'none'} />
          </button>
          <div className="menu-anchor">
            <button
              className="icon-button"
              onClick={() => setMenu(!menu)}
              aria-label={`Действия: ${app.name}`}
              aria-expanded={menu}
            >
              <MoreHorizontal size={19} />
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
                    <Users size={14} />
                    Управление доступом
                  </button>
                  {app.management_role && (
                    <button
                      onClick={() => {
                        setMenu(false);
                        onCopy();
                      }}
                    >
                      <Copy size={14} />
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
                      <Archive size={14} />
                      {app.status === 'archived' ? 'Восстановить' : 'В архив'}
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      <button className="card-main" onClick={onOpen}>
        <h3>
          {app.name}
          <ArrowUpRight size={16} />
        </h3>
        <p>{app.description || 'Без описания'}</p>
      </button>
      <div className="card-tags">
        <span className={`status-tag ${app.status === 'archived' ? 'archived' : ''}`}>
          <i />
          {app.status === 'archived'
            ? 'В архиве'
            : app.status === 'archive_pending'
              ? 'Ожидает архива'
              : 'Опубликовано'}
        </span>
        <span className="version-tag">v{app.release_count}</span>
      </div>
      <div className="card-footer">
        <span className="owner">
          <span className={`avatar mini ${app.color}`}>
            {app.owner_name
              .split(' ')
              .map((p) => p[0])
              .slice(0, 2)
              .join('')}
          </span>
          {app.owner_name}
        </span>
        <span>{relativeTime(app.updated_at)}</span>
        <span className="card-lock" title="Закрытое приложение">
          <Lock size={12} />
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
