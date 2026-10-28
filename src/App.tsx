import { useState, useEffect, useCallback, useRef, type ReactNode, type FormEvent } from 'react';
import {
  Activity as ActivityIcon,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  Archive,
  Bot,
  CalendarDays,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleDot,
  Clock3,
  Code2,
  Copy,
  Download,
  Ellipsis,
  Flag,
  FolderKanban,
  LayoutDashboard,
  LayoutGrid,
  List,
  Loader2,
  LogOut,
  Menu,
  MessageSquare,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Star,
  Target,
  Trash2,
  Users,
  X,
  Zap,
} from 'lucide-react';
import type {
  Snapshot,
  Task,
  Project,
  User,
  Status,
  Priority,
  Comment as TaskComment,
} from '../shared/types';
import { STATUSES, PRIORITIES, STATUS_LABEL, PRIORITY_LABEL } from '../shared/types';
import {
  api,
  initials,
  today,
  overdue,
  dateLabel,
  timeLabel,
  person,
  colors,
  avatarColor,
} from './lib';

type Navigate = (route: string) => void;
type Toast = (message: string) => void;
const navItems = [
  ['overview', 'Обзор', LayoutDashboard],
  ['mine', 'Мои задачи', CheckCheck],
  ['all', 'Все задачи', List],
  ['projects', 'Проекты', FolderKanban],
] as const;
function Avatar({ user, size = 'normal' }: { user?: User; size?: 'small' | 'normal' | 'large' }) {
  return (
    <span
      className={`avatar ${size}`}
      style={{
        background: user ? `${avatarColor(user.name)}24` : '#eaecef',
        color: user ? avatarColor(user.name) : '#9ca1ab',
      }}
      title={user?.name || 'Не назначен'}
    >
      {user ? initials(user.name) : <Users size={13} />}
    </span>
  );
}
function StatusDot({ status }: { status: Status }) {
  return (
    <span className={`status-dot ${status}`}>
      {status === 'done' ? <Check size={10} /> : status === 'doing' ? <span /> : null}
    </span>
  );
}
function PriorityIcon({ priority }: { priority: Priority }) {
  const Icon =
    priority === 'urgent'
      ? Flag
      : priority === 'high'
        ? ArrowUp
        : priority === 'low'
          ? ArrowDown
          : Ellipsis;
  return (
    <Icon size={14} className={`priority ${priority}`} aria-label={PRIORITY_LABEL[priority]} />
  );
}
function Empty({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <FolderKanban size={25} />
      </div>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}
function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement;
    const container = ref.current!;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusable = () =>
      Array.from(
        container.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]',
        ),
      );
    focusable()[0]?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
      if (e.key === 'Tab') {
        const items = focusable();
        const first = items[0],
          last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    container.addEventListener('keydown', key);
    return () => {
      container.removeEventListener('keydown', key);
      document.body.style.overflow = oldOverflow;
      prev?.focus();
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
        ref={ref}
        className={`modal ${wide ? 'wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Закрыть">
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
function ErrorMessage({ message }: { message: string }) {
  return message ? (
    <div className="error" role="alert">
      {message}
    </div>
  ) : null;
}
function Button({
  busy,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean }) {
  return (
    <button {...props} disabled={busy || props.disabled}>
      {busy ? <Loader2 className="spin" size={16} /> : null}
      {children}
    </button>
  );
}

function Auth({ onReady }: { onReady: () => void }) {
  const [status, setStatus] = useState<{
      initialized: boolean;
      workspace: { name: string };
    } | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [invite, setInvite] = useState<{ email: string; workspace: { name: string } } | null>(null);
  const token = new URLSearchParams(location.search).get('invite');
  useEffect(() => {
    api('/auth/status')
      .then(setStatus)
      .catch((e) => setError(e.message));
    if (token)
      api(`/auth/invite/${token}`)
        .then(setInvite)
        .catch((e) => setError(e.message));
  }, [token]);
  const setup = status && !status.initialized && !token;
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setBusy(true);
    const form = new FormData(e.currentTarget);
    try {
      await api(token ? '/auth/join' : setup ? '/auth/setup' : '/auth/login', 'POST', {
        name: form.get('name'),
        email: form.get('email'),
        password: form.get('password'),
        workspace: form.get('workspace'),
        demo: form.get('demo') === 'on',
        token,
      });
      history.replaceState({}, '', location.pathname);
      onReady();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-page">
      <aside className="auth-story">
        <div className="brand">
          <span className="logo">f</span>freejira<span className="brand-dot">.</span>
        </div>
        <div>
          <span className="eyebrow">МЕНЬШЕ ШУМА. БОЛЬШЕ ДЕЛА.</span>
          <h1>
            Много проектов.
            <br />
            Одна ясная
            <br />
            <em>картина.</em>
          </h1>
          <p>
            Соберите задачи, команду и идеи в одном пространстве. Двигайтесь вперёд вместе с AI.
          </p>
          <div className="auth-art">
            <div className="art-orbit one" />
            <div className="art-orbit two" />
            <div className="art-center">
              <FolderKanban size={38} />
            </div>
            <span className="art-chip top">
              <CheckCircle2 size={16} /> Релиз готов
            </span>
            <span className="art-chip bottom">
              <Bot size={17} /> AI на связи
            </span>
            <span className="art-dot" />
          </div>
        </div>
        <small>ВАШ РИТМ. ВАША КОМАНДА. ВАШИ ПРОЕКТЫ.</small>
      </aside>
      <main className="auth-main">
        <div className="auth-form">
          <span className="section-kicker">НАЧНЁМ С ГЛАВНОГО</span>
          <h2>
            {token ? 'Вы приглашены' : setup ? 'Ваше рабочее пространство' : 'С возвращением'}
          </h2>
          <p>
            {token
              ? `Присоединяйтесь к команде «${invite?.workspace.name || '…'}».`
              : setup
                ? 'Создайте пространство и пригласите команду.'
                : 'Войдите, чтобы продолжить работу над проектами.'}
          </p>
          <form onSubmit={submit}>
            {(setup || token) && (
              <label>
                Ваше имя
                <input
                  name="name"
                  autoComplete="name"
                  placeholder="Как к вам обращаться"
                  required
                  maxLength={80}
                />
              </label>
            )}
            {setup && (
              <label>
                Название команды
                <input
                  name="workspace"
                  placeholder="Например, Студия Север"
                  required
                  maxLength={80}
                />
              </label>
            )}
            <label>
              Email
              <input
                name="email"
                type="email"
                autoComplete="email"
                placeholder="you@company.com"
                required
                value={invite?.email}
                readOnly={!!invite}
              />
            </label>
            <label>
              Пароль
              <input
                name="password"
                type="password"
                autoComplete={setup || token ? 'new-password' : 'current-password'}
                placeholder={setup || token ? 'Не меньше 10 символов' : 'Ваш пароль'}
                minLength={10}
                maxLength={128}
                required
              />
            </label>
            {setup && (
              <label className="checkbox-label">
                <input type="checkbox" name="demo" /> Добавить примеры проектов и задач
              </label>
            )}
            <ErrorMessage message={error} />
            <Button
              className="btn primary full"
              busy={busy}
              disabled={!status || (!!token && !invite)}
              type="submit"
            >
              {token ? 'Присоединиться' : setup ? 'Создать пространство' : 'Войти'}
              <ArrowRight size={16} />
            </Button>
          </form>
          <div className="auth-note">
            <ShieldCheck size={16} />
            <span>
              Данные хранятся на вашем сервере.
              <br />
              Доступ к команде — по приглашению.
            </span>
          </div>
        </div>
      </main>
    </div>
  );
}

export default function App() {
  const [data, setData] = useState<Snapshot | null>(null),
    [loading, setLoading] = useState(true),
    [rawRoute, setRoute] = useState(location.hash.slice(1) || 'overview'),
    [toast, setToast] = useState(''),
    [error, setError] = useState(''),
    [taskEdit, setTaskEdit] = useState<Task | 'new' | null>(null),
    [projectEdit, setProjectEdit] = useState<Project | 'new' | null>(null),
    [search, setSearch] = useState(false),
    [menu, setMenu] = useState(false),
    [initialStatus, setInitialStatus] = useState<Status>('todo');
  const route = rawRoute.split('?')[0];
  const reload = useCallback(async () => {
    try {
      const status = await api('/auth/status');
      if (!status.user) {
        setData(null);
        return;
      }
      setData(await api<Snapshot>('/snapshot'));
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void reload();
    const timer = setInterval(() => {
      if (!document.hidden) void reload();
    }, 10000);
    const visible = () => {
      if (!document.hidden) void reload();
    };
    document.addEventListener('visibilitychange', visible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [reload]);
  useEffect(() => {
    const update = () => {
      setRoute(location.hash.slice(1) || 'overview');
      setMenu(false);
    };
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  const navigate: Navigate = (r) => {
    location.hash = r;
    setRoute(r);
  };
  const notify: Toast = (m) => {
    setToast(m);
  };
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(''), 4500);
      return () => clearTimeout(t);
    }
  }, [toast]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setSearch((v) => !v);
      }
      const el = e.target as HTMLElement;
      if (
        el.matches('input,textarea,select') ||
        el.isContentEditable ||
        taskEdit ||
        projectEdit ||
        search
      )
        return;
      if (!e.metaKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        setInitialStatus('todo');
        setTaskEdit('new');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [taskEdit, projectEdit, search]);
  const taskParam = new URLSearchParams(location.search).get('task');
  const openedTask = useRef(false);
  useEffect(() => {
    if (data && taskParam && !openedTask.current) {
      openedTask.current = true;
      const t = data.tasks.find((t) => t.id === taskParam);
      if (t) setTaskEdit(t);
      else notify('Задача не найдена');
    }
  }, [data, taskParam]);
  async function mutate(path: string, method: string, body?: unknown) {
    const result = await api(path, method, body);
    await reload();
    return result;
  }
  function newTask(status: Status = 'todo') {
    if (!data?.projects.some((p) => p.status !== 'archived')) {
      setProjectEdit('new');
      notify('Сначала создайте проект для задач');
      return;
    }
    setInitialStatus(status);
    setTaskEdit('new');
  }
  const openTask = (task: Task) => {
    api<Task>(`/tasks/${task.id}`)
      .then(setTaskEdit)
      .catch((e) => notify(e.message));
  };
  if (loading)
    return (
      <div className="loading-screen">
        <span className="logo">f</span>
        <Loader2 className="spin" />
      </div>
    );
  if (!data)
    return (
      <>
        <Auth onReady={reload} />
        {error && <div className="toast error">{error}</div>}
      </>
    );
  const project = data.projects.find((p) => route === `project/${p.id}`);
  const visibleProjects = data.projects.filter((p) => p.status !== 'archived');
  const activeTasks = data.tasks.filter((t) => visibleProjects.some((p) => p.id === t.project_id));
  const myCount = activeTasks.filter(
    (t) => t.assignee_id === data.user.id && t.status !== 'done',
  ).length;
  const title =
    project?.name ||
    {
      overview: 'Обзор',
      mine: 'Мои задачи',
      all: 'Все задачи',
      projects: 'Проекты',
      team: 'Команда',
      integrations: 'MCP и AI',
      settings: 'Настройки',
      activity: 'История изменений',
    }[route] ||
    'Обзор';
  return (
    <div className="app-shell">
      {menu && <div className="sidebar-scrim" onClick={() => setMenu(false)} />}
      <aside className={`sidebar ${menu ? 'open' : ''}`}>
        <a className="brand" href="#overview">
          <span className="logo">f</span>freejira<span className="brand-dot">.</span>
        </a>
        <button className="workspace-picker" onClick={() => navigate('settings')}>
          <span className="workspace-icon">{initials(data.workspace.name)}</span>
          <span>
            <strong>{data.workspace.name}</strong>
            <small>Рабочее пространство</small>
          </span>
          <ChevronDown size={14} />
        </button>
        <button className="sidebar-search" onClick={() => setSearch(true)}>
          <Search size={16} />
          <span>Найти что угодно</span>
          <kbd>⌘ K</kbd>
        </button>
        <div className="nav-group">
          <span className="nav-caption">ПРОСТРАНСТВО</span>
          {navItems.map(([key, label, Icon]) => (
            <a key={key} href={`#${key}`} className={`nav-item ${route === key ? 'active' : ''}`}>
              <Icon size={18} />
              <span>{label}</span>
              {key === 'mine' && myCount > 0 && <b>{myCount}</b>}
            </a>
          ))}
        </div>
        <div className="nav-group project-nav">
          <div className="nav-caption">
            ПРОЕКТЫ
            <button
              className="icon-btn"
              title="Создать проект"
              onClick={() => setProjectEdit('new')}
            >
              <Plus size={15} />
            </button>
          </div>
          {[...visibleProjects]
            .sort(
              (a, b) =>
                Number(data.favorites.includes(b.id)) - Number(data.favorites.includes(a.id)),
            )
            .slice(0, 12)
            .map((p) => (
              <a
                href={`#project/${p.id}`}
                className={`nav-item ${project?.id === p.id ? 'active' : ''}`}
                key={p.id}
              >
                <i className="project-dot" style={{ background: p.color }} />
                <span>{p.name}</span>
                {data.favorites.includes(p.id) && <Star size={11} className="muted" />}
              </a>
            ))}
          {visibleProjects.length === 0 && (
            <button className="sidebar-add" onClick={() => setProjectEdit('new')}>
              <Plus size={14} /> Первый проект
            </button>
          )}
          {visibleProjects.length > 12 && (
            <a className="sidebar-add" href="#projects">
              Все {visibleProjects.length} проектов <ArrowRight size={13} />
            </a>
          )}
        </div>
        <div className="sidebar-bottom">
          <a href="#team" className={`nav-item ${route === 'team' ? 'active' : ''}`}>
            <Users size={18} />
            <span>Команда</span>
            <small>{data.members.filter((u) => u.active).length}</small>
          </a>
          <a
            href="#integrations"
            className={`nav-item ${route === 'integrations' ? 'active' : ''}`}
          >
            <Bot size={18} />
            <span>MCP и AI</span>
            <span className="new-badge">NEW</span>
          </a>
          <a href="#settings" className={`nav-item ${route === 'settings' ? 'active' : ''}`}>
            <Settings2 size={18} />
            <span>Настройки</span>
          </a>
          <div className="user-box">
            <button onClick={() => navigate('settings')}>
              <Avatar user={data.user} />
              <span>
                <strong>{data.user.name}</strong>
                <small>{data.user.role === 'owner' ? 'Владелец' : 'Участник команды'}</small>
              </span>
            </button>
            <button
              className="icon-btn"
              title="Выйти"
              onClick={async () => {
                await api('/auth/logout', 'POST');
                setData(null);
              }}
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-btn mobile-menu"
              aria-label="Открыть меню"
              onClick={() => setMenu(true)}
            >
              <Menu size={20} />
            </button>
            <span>{data.workspace.name}</span>
            <ChevronRight size={13} />
            <strong>{title}</strong>
          </div>
          <div className="topbar-right">
            <span className={`sync-state ${error ? 'offline' : ''}`}>
              <i />
              {error ? 'Нет связи' : 'Всё сохранено'}
            </span>
            <span className="topbar-divider" />
            <button className="icon-btn" aria-label="Поиск" onClick={() => setSearch(true)}>
              <Search size={18} />
            </button>
            <Avatar user={data.user} size="small" />
          </div>
        </header>
        {error && (
          <div className="connection-error">
            {error} <button onClick={() => void reload()}>Повторить</button>
          </div>
        )}
        <main className="main-content">
          {route === 'overview' && (
            <Overview
              data={data}
              navigate={navigate}
              openTask={openTask}
              newProject={() => setProjectEdit('new')}
              newTask={() => newTask()}
              mutate={mutate}
              notify={notify}
            />
          )}
          {route === 'projects' && (
            <Projects
              data={data}
              navigate={navigate}
              create={() => setProjectEdit('new')}
              mutate={mutate}
              notify={notify}
            />
          )}
          {(route === 'all' || route === 'mine' || project) && (
            <TaskView
              key={`${route}-${rawRoute}`}
              data={data}
              project={project}
              mine={route === 'mine'}
              openTask={openTask}
              create={newTask}
              editProject={() => project && setProjectEdit(project)}
              mutate={mutate}
              notify={notify}
            />
          )}
          {route === 'team' && <Team data={data} mutate={mutate} notify={notify} />}
          {route === 'integrations' && <Integrations notify={notify} />}
          {route === 'settings' && <Settings data={data} mutate={mutate} notify={notify} />}
          {route === 'activity' && (
            <>
              <PageHeader
                eyebrow="ПУЛЬС КОМАНДЫ"
                title="История изменений"
                description="Что изменилось, кто это сделал и откуда — из интерфейса или через AI."
              />
              <div className="panel">
                <ActivityList data={data} openTask={openTask} limit={100} />
              </div>
            </>
          )}
          {route.startsWith('project/') && !project && (
            <Empty
              title="Проект не найден"
              text="Возможно, ссылка устарела."
              action={
                <button className="btn" onClick={() => navigate('projects')}>
                  К проектам
                </button>
              }
            />
          )}
        </main>
        <footer className="app-footer">
          <span>Чуть меньше хаоса. Чуть больше сделанного.</span>
          <span>
            freejira <i /> {new Date().getFullYear()}
          </span>
        </footer>
      </div>
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={17} />
          {toast}
        </div>
      )}
      {taskEdit && (
        <TaskEditor
          task={taskEdit === 'new' ? undefined : taskEdit}
          defaultProject={project?.id}
          initialStatus={initialStatus}
          data={data}
          close={() => setTaskEdit(null)}
          mutate={mutate}
          notify={notify}
        />
      )}
      {projectEdit && (
        <ProjectEditor
          project={projectEdit === 'new' ? undefined : projectEdit}
          close={() => setProjectEdit(null)}
          mutate={mutate}
          onCreated={(p) => navigate(`project/${p.id}`)}
          notify={notify}
        />
      )}
      {search && (
        <GlobalSearch
          data={data}
          close={() => setSearch(false)}
          navigate={navigate}
          openTask={openTask}
        />
      )}
    </div>
  );
}

function PageHeader({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        {eyebrow && <span className="section-kicker">{eyebrow}</span>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      <div className="page-actions">{children}</div>
    </div>
  );
}
function ProjectCard({
  project: p,
  data,
  navigate,
  mutate,
  notify,
}: {
  project: Project;
  data: Snapshot;
  navigate: Navigate;
  mutate: Function;
  notify: Toast;
}) {
  const tasks = data.tasks.filter((t) => t.project_id === p.id),
    done = tasks.filter((t) => t.status === 'done').length,
    progress = tasks.length ? Math.round((done / tasks.length) * 100) : 0,
    late = tasks.filter(overdue).length;
  const members = data.members.filter((m) => tasks.some((t) => t.assignee_id === m.id));
  return (
    <article className="project-card">
      <div className="project-card-top">
        <span className="project-symbol" style={{ color: p.color, background: `${p.color}18` }}>
          <FolderKanban size={21} />
        </span>
        <span className={`project-state ${p.status}`}>
          {
            {
              active: 'В процессе',
              paused: 'На паузе',
              completed: 'Завершён',
              archived: 'В архиве',
            }[p.status]
          }
        </span>
        <button
          className={`icon-btn favorite ${data.favorites.includes(p.id) ? 'selected' : ''}`}
          aria-label={data.favorites.includes(p.id) ? 'Убрать из избранного' : 'В избранное'}
          onClick={() =>
            mutate(`/favorites/${p.id}`, 'PUT', { favorite: !data.favorites.includes(p.id) }).catch(
              (e: Error) => notify(e.message),
            )
          }
        >
          <Star size={16} />
        </button>
      </div>
      <button className="project-title-button" onClick={() => navigate(`project/${p.id}`)}>
        <h3>{p.name}</h3>
        <ArrowUpRight size={17} />
      </button>
      <p className="project-description">
        {p.description || 'Большие идеи начинаются с первого шага.'}
      </p>
      <div className="progress-caption">
        <span>
          Прогресс{' '}
          <strong>
            {done}
            <span> / {tasks.length}</span>
          </strong>
        </span>
        <b>{progress}%</b>
      </div>
      <div className="progress-track">
        <i style={{ width: `${progress}%`, background: p.color }} />
      </div>
      <div className="project-card-footer">
        <div className="avatar-stack">
          {members.slice(0, 4).map((m) => (
            <Avatar key={m.id} user={m} size="small" />
          ))}
          {members.length === 0 && <span className="muted small-text">Нет назначений</span>}
        </div>
        {late > 0 ? (
          <span className="due overdue">
            <Clock3 size={12} />
            {late} просрочено
          </span>
        ) : (
          <span className="due">
            <CalendarDays size={12} />
            {dateLabel(p.target_date)}
          </span>
        )}
      </div>
    </article>
  );
}
function ActivityList({
  data,
  openTask,
  limit = 5,
}: {
  data: Snapshot;
  openTask: (t: Task) => void;
  limit?: number;
}) {
  return (
    <div className="activity-list">
      {data.activities.slice(0, limit).map((a) => (
        <div className="activity-item" key={a.id}>
          <Avatar user={person(data.members, a.user_id)} size="small" />
          <div>
            <p>
              <strong>{person(data.members, a.user_id)?.name || 'Участник'}</strong>
              {a.source === 'mcp' && (
                <span className="tiny-badge">
                  <Bot size={10} /> MCP
                </span>
              )}
            </p>
            <button
              disabled={!data.tasks.some((t) => t.id === a.task_id)}
              onClick={() => {
                const t = data.tasks.find((t) => t.id === a.task_id);
                if (t) openTask(t);
              }}
            >
              {a.detail.replace(
                /backlog|todo|doing|review|done/g,
                (s) => STATUS_LABEL[s as Status],
              )}
            </button>
            <time>{timeLabel(a.created_at)}</time>
          </div>
        </div>
      ))}
      {data.activities.length === 0 && (
        <p className="muted">Здесь появятся изменения в ваших проектах.</p>
      )}
    </div>
  );
}
function Overview({
  data,
  navigate,
  openTask,
  newProject,
  newTask,
  mutate,
  notify,
}: {
  data: Snapshot;
  navigate: Navigate;
  openTask: (t: Task) => void;
  newProject: () => void;
  newTask: () => void;
  mutate: Function;
  notify: Toast;
}) {
  const projects = data.projects.filter((p) => p.status !== 'archived'),
    tasks = data.tasks.filter((t) => projects.some((p) => p.id === t.project_id)),
    done = tasks.filter((t) => t.status === 'done').length;
  const focus = tasks
    .filter((t) => t.status !== 'done')
    .sort(
      (a, b) =>
        Number(b.assignee_id === data.user.id) - Number(a.assignee_id === data.user.id) ||
        (a.due_date || '9999').localeCompare(b.due_date || '9999'),
    )
    .slice(0, 5);
  return (
    <>
      <PageHeader
        eyebrow={new Date()
          .toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })
          .toUpperCase()}
        title={`Всё под контролем, ${data.user.name.split(' ')[0]}`}
        description="Ваши проекты, приоритеты и команда. В одной картине."
      >
        <button className="btn" onClick={newTask}>
          <Plus size={16} /> Задача
        </button>
        <button className="btn primary" onClick={newProject}>
          <Plus size={16} /> Новый проект
        </button>
      </PageHeader>
      <div className="stats-grid">
        {[
          {
            label: 'Активные проекты',
            value: projects.filter((p) => p.status === 'active').length,
            icon: FolderKanban,
            color: 'purple',
            sub: 'В вашем пространстве',
            route: 'projects',
          },
          {
            label: 'В работе',
            value: tasks.filter((t) => t.status === 'doing').length,
            icon: CircleDot,
            color: 'blue',
            sub: 'Двигаемся вперёд',
            route: 'all',
          },
          {
            label: 'Завершено',
            value: done,
            icon: CheckCircle2,
            color: 'green',
            sub: `${tasks.length ? Math.round((done / tasks.length) * 100) : 0}% от всех задач`,
            route: 'all',
          },
          {
            label: 'Требуют внимания',
            value: tasks.filter(overdue).length,
            icon: Clock3,
            color: 'orange',
            sub: 'Задачи с истёкшим сроком',
            route: 'all',
          },
        ].map((s) => (
          <button
            className="stat-card"
            key={s.label}
            onClick={() => navigate(s.route + (s.color === 'orange' ? '?overdue=1' : ''))}
          >
            <div>
              <span>{s.label}</span>
              <s.icon size={17} className={s.color} />
            </div>
            <strong>{String(s.value).padStart(2, '0')}</strong>
            <small>{s.sub}</small>
          </button>
        ))}
      </div>
      <div className="section-heading">
        <h2>
          В фокусе <span>{projects.length}</span>
        </h2>
        <button className="text-btn" onClick={() => navigate('projects')}>
          Все проекты <ArrowRight size={15} />
        </button>
      </div>
      {projects.length ? (
        <div className="projects-grid">
          {[...projects]
            .sort(
              (a, b) =>
                Number(data.favorites.includes(b.id)) - Number(data.favorites.includes(a.id)),
            )
            .slice(0, 3)
            .map((p) => (
              <ProjectCard
                project={p}
                data={data}
                navigate={navigate}
                key={p.id}
                mutate={mutate}
                notify={notify}
              />
            ))}
        </div>
      ) : (
        <Empty
          title="Место для вашего следующего проекта"
          text="Создайте проект, добавьте задачи и пригласите тех, с кем будете двигаться вперёд."
          action={
            <button className="btn primary" onClick={newProject}>
              <Plus size={16} /> Создать проект
            </button>
          }
        />
      )}
      <div className="overview-bottom">
        <section className="panel focus-panel">
          <div className="panel-header">
            <h2>
              <Target size={17} /> Ближайшие задачи
            </h2>
            <button className="text-btn" onClick={() => navigate('mine')}>
              Мои задачи <ArrowUpRight size={15} />
            </button>
          </div>
          {focus.length ? (
            focus.map((t) => (
              <button className="focus-row" key={t.id} onClick={() => openTask(t)}>
                <StatusDot status={t.status} />
                <div>
                  <strong>{t.title}</strong>
                  <small>
                    <i style={{ background: projects.find((p) => p.id === t.project_id)?.color }} />
                    {projects.find((p) => p.id === t.project_id)?.name}
                  </small>
                </div>
                <PriorityIcon priority={t.priority} />
                <span className={`due ${overdue(t) ? 'overdue' : ''}`}>
                  {dateLabel(t.due_date)}
                </span>
                <Avatar user={person(data.members, t.assignee_id)} size="small" />
              </button>
            ))
          ) : (
            <Empty
              title="Можно выдохнуть"
              text="Открытых задач пока нет. Самое время начать что-то новое."
            />
          )}
          <button className="panel-add" onClick={newTask}>
            <Plus size={15} /> Добавить задачу
          </button>
        </section>
        <section className="panel">
          <div className="panel-header">
            <h2>
              <ActivityIcon size={17} /> Что нового
            </h2>
            <button className="icon-btn" title="Вся история" onClick={() => navigate('activity')}>
              <ArrowUpRight size={16} />
            </button>
          </div>
          <ActivityList data={data} openTask={openTask} />
        </section>
      </div>
      <div className="ai-banner">
        <div className="ai-banner-icon">
          <Sparkles size={23} />
        </div>
        <div>
          <strong>Ваш AI тоже часть команды</strong>
          <p>
            Подключите MCP, чтобы планировать проекты и обновлять задачи прямо из AI-ассистента.
          </p>
        </div>
        <button className="btn" onClick={() => navigate('integrations')}>
          Подключить AI <ArrowUpRight size={15} />
        </button>
      </div>
    </>
  );
}
function Projects({
  data,
  navigate,
  create,
  mutate,
  notify,
}: {
  data: Snapshot;
  navigate: Navigate;
  create: () => void;
  mutate: Function;
  notify: Toast;
}) {
  const [filter, setFilter] = useState('active'),
    [query, setQuery] = useState('');
  const projects = data.projects.filter(
    (p) =>
      (filter === 'all'
        ? p.status !== 'archived'
        : filter === 'favorites'
          ? data.favorites.includes(p.id) && p.status !== 'archived'
          : p.status === filter) &&
      `${p.name} ${p.key} ${p.description}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <PageHeader
        eyebrow="БОЛЬШАЯ КАРТИНА"
        title="Проекты"
        description="От первых идей до последнего шага. Каждый проект на своём месте."
      >
        <button className="btn primary" onClick={create}>
          <Plus size={16} /> Новый проект
        </button>
      </PageHeader>
      <div className="toolbar">
        <div className="tabs">
          {[
            ['active', 'Активные'],
            ['all', 'Все'],
            ['favorites', 'Избранное'],
            ['archived', 'Архив'],
          ].map(([v, l]) => (
            <button key={v} className={filter === v ? 'selected' : ''} onClick={() => setFilter(v)}>
              {l}
            </button>
          ))}
        </div>
        <div className="input-icon">
          <Search size={15} />
          <input
            placeholder="Найти проект…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Поиск проектов"
          />
        </div>
      </div>
      {projects.length ? (
        <div className="projects-grid portfolio">
          {projects.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              data={data}
              navigate={navigate}
              mutate={mutate}
              notify={notify}
            />
          ))}
        </div>
      ) : (
        <Empty
          title={query ? 'Ничего не найдено' : 'Здесь пока тихо'}
          text={
            filter === 'archived'
              ? 'Архивные проекты сохраняют все задачи и историю.'
              : 'Создайте новый проект или измените фильтры.'
          }
          action={
            <button className="btn" onClick={create}>
              <Plus size={15} /> Создать проект
            </button>
          }
        />
      )}
    </>
  );
}

function TaskView({
  data,
  project,
  mine,
  openTask,
  create,
  editProject,
  mutate,
  notify,
}: {
  data: Snapshot;
  project?: Project;
  mine: boolean;
  openTask: (t: Task) => void;
  create: (s?: Status) => void;
  editProject: () => void;
  mutate: Function;
  notify: Toast;
}) {
  const [view, setView] = useState(
      localStorage.getItem(project ? 'fj-project-view' : 'fj-all-view') ||
        (project ? 'board' : 'list'),
    ),
    [query, setQuery] = useState(''),
    [assignee, setAssignee] = useState(''),
    [priority, setPriority] = useState(''),
    [status, setStatus] = useState(''),
    [due, setDue] = useState(location.hash.includes('overdue=1') ? 'overdue' : ''),
    [projectFilter, setProjectFilter] = useState(''),
    [dragOver, setDragOver] = useState<Status | null>(null);
  const tasks = data.tasks.filter(
    (t) =>
      (project
        ? t.project_id === project.id
        : data.projects.some((p) => p.id === t.project_id && p.status !== 'archived')) &&
      (!mine || t.assignee_id === data.user.id) &&
      (!projectFilter || t.project_id === projectFilter) &&
      (!assignee || (assignee === 'none' ? !t.assignee_id : t.assignee_id === assignee)) &&
      (!priority || t.priority === priority) &&
      (!status || t.status === status) &&
      (!due || overdue(t)) &&
      `${t.title} ${t.tags.join(' ')} ${data.projects.find((p) => p.id === t.project_id)?.key}-${t.number}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const sorted = [...tasks].sort(
    (a, b) =>
      Number(a.status === 'done') - Number(b.status === 'done') ||
      PRIORITIES.indexOf(a.priority) - PRIORITIES.indexOf(b.priority) ||
      (a.due_date || '9999').localeCompare(b.due_date || '9999'),
  );
  async function move(id: string, status: Status) {
    const t = data.tasks.find((t) => t.id === id);
    if (t && t.status !== status) {
      try {
        await mutate(`/tasks/${id}`, 'PATCH', { status, revision: t.revision });
        notify(`Задача перемещена: ${STATUS_LABEL[status]}`);
      } catch (e) {
        notify((e as Error).message);
      }
    }
    setDragOver(null);
  }
  const total = data.tasks.filter((t) =>
    project
      ? t.project_id === project.id
      : (!mine || t.assignee_id === data.user.id) &&
        data.projects.some((p) => p.id === t.project_id && p.status !== 'archived'),
  );
  const reset = () => {
    setQuery('');
    setAssignee('');
    setPriority('');
    setStatus('');
    setDue('');
    setProjectFilter('');
  };
  const filtered = !!(query || assignee || priority || status || due || projectFilter);
  return (
    <>
      <PageHeader
        eyebrow={project ? `${project.key} / ПРОЕКТ` : mine ? 'ЛИЧНЫЙ ФОКУС' : 'ЕДИНЫЙ БЭКЛОГ'}
        title={project?.name || (mine ? 'Мои задачи' : 'Все задачи')}
        description={
          project?.description ||
          (mine
            ? 'То, за что отвечаете вы. Сначала важное, потом остальное.'
            : 'Общий взгляд на работу во всех проектах команды.')
        }
      >
        <button
          className="btn primary"
          onClick={() => create()}
          disabled={project?.status === 'archived'}
        >
          <Plus size={16} /> Новая задача
        </button>
        {project && (
          <button className="btn icon-only" aria-label="Настройки проекта" onClick={editProject}>
            <Settings2 size={17} />
          </button>
        )}
      </PageHeader>
      <div className="task-summary">
        <div className="avatar-stack">
          {data.members
            .filter((u) => total.some((t) => t.assignee_id === u.id))
            .slice(0, 5)
            .map((u) => (
              <Avatar user={u} size="small" key={u.id} />
            ))}
        </div>
        <span>{total.length} задач</span>
        <i />
        <span>
          <CheckCircle2 size={13} />
          {total.filter((t) => t.status === 'done').length} завершено
        </span>
        {project?.target_date && (
          <>
            <i />
            <span>
              <CalendarDays size={13} /> До {dateLabel(project.target_date)}
            </span>
          </>
        )}
        {project?.status === 'archived' && <span className="tag">В архиве</span>}
      </div>
      <div className="toolbar task-toolbar">
        <div className="view-toggle">
          <button
            className={view === 'board' ? 'selected' : ''}
            onClick={() => {
              setView('board');
              localStorage.setItem(project ? 'fj-project-view' : 'fj-all-view', 'board');
            }}
          >
            <LayoutGrid size={15} /> Доска
          </button>
          <button
            className={view === 'list' ? 'selected' : ''}
            onClick={() => {
              setView('list');
              localStorage.setItem(project ? 'fj-project-view' : 'fj-all-view', 'list');
            }}
          >
            <List size={16} /> Список
          </button>
        </div>
        <div className="input-icon">
          <Search size={15} />
          <input
            placeholder="Поиск задач…"
            aria-label="Поиск задач"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>
      <div className="filter-bar">
        {!project && (
          <select
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
            aria-label="Фильтр по проекту"
          >
            <option value="">Все проекты</option>
            {data.projects
              .filter((p) => p.status !== 'archived')
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        )}
        {!mine && (
          <select
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
            aria-label="Фильтр по участнику"
          >
            <option value="">Участник</option>
            <option value="none">Не назначен</option>
            {data.members
              .filter((u) => u.active)
              .map((u) => (
                <option value={u.id} key={u.id}>
                  {u.name}
                </option>
              ))}
          </select>
        )}
        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
          aria-label="Фильтр по приоритету"
        >
          <option value="">Приоритет</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {PRIORITY_LABEL[p]}
            </option>
          ))}
        </select>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label="Фильтр по статусу"
        >
          <option value="">Статус</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <button
          className={`filter-pill ${due ? 'selected' : ''}`}
          onClick={() => setDue(due ? '' : 'overdue')}
        >
          <Clock3 size={13} /> Просроченные
        </button>
        {filtered && (
          <button className="text-btn" onClick={reset}>
            <X size={13} /> Сбросить
          </button>
        )}
        <span className="filter-count">{tasks.length} задач</span>
      </div>
      {view === 'board' ? (
        <div className="board">
          {STATUSES.filter((s) => !status || status === s).map((s) => (
            <section
              className={`board-column ${dragOver === s ? 'drag-over' : ''}`}
              key={s}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(s);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                void move(e.dataTransfer.getData('text/plain'), s);
              }}
            >
              <div className="column-head">
                <StatusDot status={s} />
                <h3>{STATUS_LABEL[s]}</h3>
                <span>{tasks.filter((t) => t.status === s).length}</span>
                <button
                  className="icon-btn"
                  title={`Добавить: ${STATUS_LABEL[s]}`}
                  onClick={() => create(s)}
                  disabled={project?.status === 'archived'}
                >
                  <Plus size={15} />
                </button>
              </div>
              <div className="column-tasks">
                {sorted
                  .filter((t) => t.status === s)
                  .map((t) => (
                    <TaskCard key={t.id} task={t} data={data} open={() => openTask(t)} />
                  ))}
                {tasks.filter((t) => t.status === s).length === 0 && (
                  <div className="column-empty">
                    {dragOver === s ? 'Отпустите задачу здесь' : 'Пока нет задач'}
                  </div>
                )}
              </div>
              <button
                className="board-add"
                onClick={() => create(s)}
                disabled={project?.status === 'archived'}
              >
                <Plus size={14} /> Добавить задачу
              </button>
            </section>
          ))}
        </div>
      ) : (
        <div className="table-wrap">
          <table className="task-table">
            <thead>
              <tr>
                <th>Задача</th>
                {!project && <th>Проект</th>}
                <th>Статус</th>
                <th>Приоритет</th>
                <th>Участник</th>
                <th>Срок</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((t) => (
                <tr key={t.id}>
                  <td>
                    <button className="task-title-cell" onClick={() => openTask(t)}>
                      <span className="task-code">
                        {data.projects.find((p) => p.id === t.project_id)?.key}-{t.number}
                      </span>
                      <span className={t.status === 'done' ? 'completed-title' : ''}>
                        {t.title}
                      </span>
                    </button>
                  </td>
                  {!project && (
                    <td>
                      <span className="project-cell">
                        <i
                          style={{
                            background: data.projects.find((p) => p.id === t.project_id)?.color,
                          }}
                        />
                        {data.projects.find((p) => p.id === t.project_id)?.name}
                      </span>
                    </td>
                  )}
                  <td>
                    <select
                      className={`inline-status ${t.status}`}
                      value={t.status}
                      onChange={(e) => void move(t.id, e.target.value as Status)}
                      aria-label={`Статус ${t.title}`}
                    >
                      {STATUSES.map((s) => (
                        <option value={s} key={s}>
                          {STATUS_LABEL[s]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <span className="priority-cell">
                      <PriorityIcon priority={t.priority} />
                      {PRIORITY_LABEL[t.priority]}
                    </span>
                  </td>
                  <td>
                    <Avatar user={person(data.members, t.assignee_id)} size="small" />
                  </td>
                  <td>
                    <span className={`due ${overdue(t) ? 'overdue' : ''}`}>
                      {dateLabel(t.due_date)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {tasks.length === 0 && (
            <Empty
              title="Ни одной задачи"
              text={
                filtered
                  ? 'Попробуйте изменить фильтры или поисковый запрос.'
                  : 'Добавьте первую задачу и сделайте первый шаг.'
              }
              action={
                <button className="btn" onClick={() => (filtered ? reset() : create())}>
                  {filtered ? 'Сбросить фильтры' : 'Создать задачу'}
                </button>
              }
            />
          )}
        </div>
      )}
    </>
  );
}
function TaskCard({ task: t, data, open }: { task: Task; data: Snapshot; open: () => void }) {
  const p = data.projects.find((p) => p.id === t.project_id);
  return (
    <article
      className={`task-card ${t.status === 'done' ? 'done' : ''}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', t.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onDragEnd={(e) => e.currentTarget.blur()}
    >
      <div className="task-card-top">
        <span className="task-code">
          <i style={{ background: p?.color }} />
          {p?.key}-{t.number}
        </span>
        <PriorityIcon priority={t.priority} />
      </div>
      <button onClick={open} className="task-card-title">
        {t.title}
      </button>
      {t.tags.length > 0 && (
        <div className="tags">
          {t.tags.slice(0, 3).map((tag) => (
            <span className="tag" key={tag}>
              {tag}
            </span>
          ))}
        </div>
      )}
      <div className="task-card-footer">
        <span className={`due ${overdue(t) ? 'overdue' : ''}`}>
          <CalendarDays size={12} />
          {dateLabel(t.due_date)}
        </span>
        <Avatar user={person(data.members, t.assignee_id)} size="small" />
      </div>
    </article>
  );
}

function ProjectEditor({
  project,
  close,
  mutate,
  onCreated,
  notify,
}: {
  project?: Project;
  close: () => void;
  mutate: Function;
  onCreated: (p: Project) => void;
  notify: Toast;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [color, setColor] = useState(project?.color || colors[0]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const f = new FormData(e.currentTarget);
    try {
      const p = await mutate(
        project ? `/projects/${project.id}` : '/projects',
        project ? 'PATCH' : 'POST',
        {
          name: f.get('name'),
          key: String(f.get('key')).toUpperCase(),
          description: f.get('description'),
          color,
          status: f.get('status') || 'active',
          target_date: f.get('target_date') || null,
          ...(project ? { revision: project.revision } : {}),
        },
      );
      notify(project ? 'Проект обновлён' : 'Проект создан');
      close();
      if (!project) onCreated(p);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={project ? 'Настройки проекта' : 'Новый проект'} onClose={close}>
      <form onSubmit={submit} className="editor-form">
        <div className="color-picker">
          {colors.map((c) => (
            <button
              type="button"
              key={c}
              style={{ background: c }}
              className={color === c ? 'selected' : ''}
              onClick={() => setColor(c)}
              aria-label={`Цвет ${c}`}
            >
              {color === c && <Check size={15} />}
            </button>
          ))}
        </div>
        <label>
          Название проекта
          <input
            name="name"
            defaultValue={project?.name}
            placeholder="Например, Запуск мобильного приложения"
            required
            maxLength={120}
          />
        </label>
        <div className="form-grid">
          <label>
            Код проекта
            <input
              name="key"
              defaultValue={project?.key}
              placeholder="APP"
              pattern="[A-Za-z][A-Za-z0-9]{1,7}"
              title="От 2 до 8 латинских букв и цифр, начинается с буквы"
              minLength={2}
              maxLength={8}
              required
              readOnly={!!project}
              style={{ textTransform: 'uppercase' }}
            />
          </label>
          <label>
            Целевая дата
            <input name="target_date" type="date" defaultValue={project?.target_date || ''} />
          </label>
        </div>
        <label>
          О чём этот проект
          <textarea
            name="description"
            defaultValue={project?.description}
            placeholder="Цель, контекст и ожидаемый результат"
            rows={3}
            maxLength={10000}
          />
        </label>
        {project && (
          <label>
            Состояние
            <select name="status" defaultValue={project.status}>
              <option value="active">Активный</option>
              <option value="paused">На паузе</option>
              <option value="completed">Завершён</option>
              <option value="archived">В архиве</option>
            </select>
            <small className="muted">
              Архив скрывает проект из общего обзора. Данные сохраняются.
            </small>
          </label>
        )}
        <ErrorMessage message={error} />
        <div className="modal-footer">
          <button className="btn" type="button" onClick={close}>
            Отмена
          </button>
          <Button className="btn primary" type="submit" busy={busy}>
            {project ? 'Сохранить изменения' : 'Создать проект'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function TaskEditor({
  task,
  defaultProject,
  initialStatus,
  data,
  close,
  mutate,
  notify,
}: {
  task?: Task;
  defaultProject?: string;
  initialStatus: Status;
  data: Snapshot;
  close: () => void;
  mutate: Function;
  notify: Toast;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [comments, setComments] = useState<TaskComment[]>([]),
    [comment, setComment] = useState(''),
    [commentBusy, setCommentBusy] = useState(false),
    [confirm, setConfirm] = useState(false);
  useEffect(() => {
    if (task)
      api<TaskComment[]>(`/tasks/${task.id}/comments`)
        .then(setComments)
        .catch((e) => setError(e.message));
  }, [task]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const f = new FormData(e.currentTarget);
    try {
      await mutate(task ? `/tasks/${task.id}` : '/tasks', task ? 'PATCH' : 'POST', {
        project_id: f.get('project_id'),
        title: f.get('title'),
        description: f.get('description'),
        status: f.get('status'),
        priority: f.get('priority'),
        assignee_id: f.get('assignee_id') || null,
        due_date: f.get('due_date') || null,
        tags: [
          ...new Set(
            String(f.get('tags') || '')
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean),
          ),
        ],
        ...(task ? { revision: task.revision } : {}),
      });
      close();
      notify(task ? 'Изменения сохранены' : 'Задача создана');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function addComment(e: FormEvent) {
    e.preventDefault();
    if (!comment.trim() || !task) return;
    setCommentBusy(true);
    try {
      const c = await mutate(`/tasks/${task.id}/comments`, 'POST', { body: comment });
      setComments((v) => [...v, c]);
      setComment('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCommentBusy(false);
    }
  }
  return (
    <Modal
      title={
        task
          ? `${data.projects.find((p) => p.id === task.project_id)?.key}-${task.number}`
          : 'Новая задача'
      }
      onClose={close}
      wide
    >
      <form onSubmit={submit} className="editor-form task-editor">
        <label className="title-label">
          Название задачи
          <input
            className="task-title-input"
            name="title"
            defaultValue={task?.title}
            placeholder="Что нужно сделать?"
            required
            maxLength={240}
          />
        </label>
        <div className="form-grid">
          <label>
            Проект
            <select
              name="project_id"
              defaultValue={
                task?.project_id ||
                defaultProject ||
                data.projects.find((p) => p.status !== 'archived')?.id
              }
              disabled={!!task}
              required
            >
              {data.projects
                .filter((p) => p.status !== 'archived' || p.id === task?.project_id)
                .map((p) => (
                  <option value={p.id} key={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Статус
            <select name="status" defaultValue={task?.status || initialStatus}>
              {STATUSES.map((s) => (
                <option value={s} key={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Приоритет
            <select name="priority" defaultValue={task?.priority || 'medium'}>
              {PRIORITIES.map((p) => (
                <option value={p} key={p}>
                  {PRIORITY_LABEL[p]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Ответственный
            <select name="assignee_id" defaultValue={task?.assignee_id || ''}>
              <option value="">Не назначен</option>
              {data.members
                .filter((u) => u.active || u.id === task?.assignee_id)
                .map((u) => (
                  <option value={u.id} key={u.id} disabled={!u.active}>
                    {u.name}
                    {!u.active ? ' (отключён)' : ''}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Срок
            <input type="date" name="due_date" defaultValue={task?.due_date || ''} />
          </label>
          <label>
            Метки через запятую
            <input
              name="tags"
              defaultValue={task?.tags.join(', ')}
              placeholder="Дизайн, Релиз"
              maxLength={247}
            />
          </label>
        </div>
        <label>
          Описание
          <textarea
            name="description"
            defaultValue={task?.description}
            placeholder="Контекст, требования, ссылки и критерии готовности…"
            rows={5}
            maxLength={20000}
          />
        </label>
        <ErrorMessage message={error} />
        <div className="modal-footer task-editor-actions">
          {task && (
            <div className="task-secondary-actions">
              <button
                className="icon-btn"
                type="button"
                aria-label="Скопировать ссылку на задачу"
                onClick={() =>
                  navigator.clipboard
                    .writeText(`${location.origin}/?task=${task.id}#project/${task.project_id}`)
                    .then(() => notify('Ссылка скопирована'))
                    .catch(() => setError('Не удалось скопировать ссылку'))
                }
              >
                <Copy size={16} />
              </button>
              <button
                className="icon-btn danger"
                type="button"
                aria-label="Удалить задачу"
                onClick={() => setConfirm(true)}
              >
                <Trash2 size={16} />
              </button>
            </div>
          )}
          <button className="btn" type="button" onClick={close}>
            Отмена
          </button>
          <Button className="btn primary" busy={busy} type="submit">
            {task ? 'Сохранить' : 'Создать задачу'}
          </Button>
        </div>
        {confirm && (
          <div className="delete-confirm">
            <span>Удалить задачу и скрыть её из проектов?</span>
            <button
              type="button"
              className="btn danger"
              onClick={async () => {
                try {
                  await mutate(`/tasks/${task!.id}`, 'DELETE', { revision: task!.revision });
                  close();
                  notify('Задача удалена');
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Удалить
            </button>
            <button type="button" className="text-btn" onClick={() => setConfirm(false)}>
              Оставить
            </button>
          </div>
        )}
      </form>
      {task && (
        <section className="comments">
          <h3>
            <MessageSquare size={16} /> Обсуждение <span>{comments.length}</span>
          </h3>
          {comments.map((c) => (
            <div className="comment" key={c.id}>
              <Avatar user={person(data.members, c.user_id)} size="small" />
              <div>
                <strong>{person(data.members, c.user_id)?.name}</strong>
                <time>{timeLabel(c.created_at)}</time>
                <p>{c.body}</p>
              </div>
            </div>
          ))}
          {comments.length === 0 && (
            <p className="muted small-text">Обсудите детали или оставьте заметку для команды.</p>
          )}
          <form onSubmit={addComment} className="comment-form">
            <textarea
              aria-label="Комментарий"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Написать комментарий…"
              rows={2}
              maxLength={10000}
              required
            />
            <Button className="btn" busy={commentBusy} disabled={!comment.trim()} type="submit">
              Отправить <ArrowUpRight size={14} />
            </Button>
          </form>
        </section>
      )}
    </Modal>
  );
}
function Team({ data, mutate, notify }: { data: Snapshot; mutate: Function; notify: Toast }) {
  const [invites, setInvites] = useState<{ id: string; email: string; expires_at: string }[]>([]),
    [email, setEmail] = useState(''),
    [link, setLink] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const owner = data.user.role === 'owner';
  const refresh = useCallback(() => {
    if (owner)
      api('/invites')
        .then(setInvites)
        .catch((e) => setError(e.message));
  }, [owner]);
  useEffect(refresh, [refresh]);
  async function invite(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api('/invites', 'POST', { email });
      setLink(`${location.origin}/?invite=${r.token}`);
      setEmail('');
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeader
        eyebrow="ВМЕСТЕ ПОЛУЧАЕТСЯ БОЛЬШЕ"
        title="Команда"
        description="Люди, которые двигают проекты вперёд."
      />
      <div className="team-stats">
        <span>
          <Users size={17} />
          <strong>{data.members.filter((m) => m.active).length}</strong> участников
        </span>
        <span>
          <ShieldCheck size={17} /> Общее пространство, личные аккаунты
        </span>
      </div>
      {owner && (
        <section className="panel invite-panel">
          <div>
            <h2>Хорошие проекты делают вместе</h2>
            <p>Создайте персональную ссылку и передайте её коллеге. Ссылка действует 7 дней.</p>
          </div>
          <form onSubmit={invite}>
            <input
              type="email"
              placeholder="colleague@company.com"
              aria-label="Email приглашённого"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <Button busy={busy} className="btn primary" type="submit">
              <Plus size={16} /> Пригласить
            </Button>
          </form>
          {link && (
            <div className="invite-result">
              <span>Приглашение создано. Отправьте эту ссылку коллеге:</span>
              <div>
                <input
                  value={link}
                  readOnly
                  aria-label="Ссылка приглашения"
                  onFocus={(e) => e.target.select()}
                />
                <button
                  className="btn"
                  onClick={() =>
                    navigator.clipboard
                      .writeText(link)
                      .then(() => notify('Приглашение скопировано'))
                      .catch(() => setError('Выделите и скопируйте ссылку вручную'))
                  }
                >
                  <Copy size={15} /> Копировать
                </button>
              </div>
              {['localhost', '127.0.0.1'].includes(location.hostname) && (
                <small>
                  Для входа с другого устройства откройте Freejira по общему адресу сервера и
                  создайте ссылку там.
                </small>
              )}
            </div>
          )}
          <ErrorMessage message={error} />
        </section>
      )}
      <div className="panel table-wrap">
        <table className="members-table">
          <thead>
            <tr>
              <th>Участник</th>
              <th>Роль</th>
              <th>Открытые задачи</th>
              <th>Доступ</th>
              {owner && <th />}
            </tr>
          </thead>
          <tbody>
            {data.members.map((m) => (
              <tr key={m.id}>
                <td>
                  <div className="member-cell">
                    <Avatar user={m} />
                    <span>
                      <strong>
                        {m.name}
                        {m.id === data.user.id && <small> · вы</small>}
                      </strong>
                      <small>{m.email}</small>
                    </span>
                  </div>
                </td>
                <td>{m.role === 'owner' ? 'Владелец' : 'Участник'}</td>
                <td>
                  <span className="workload-count">
                    {
                      data.tasks.filter(
                        (t) =>
                          t.assignee_id === m.id &&
                          t.status !== 'done' &&
                          data.projects.some(
                            (p) => p.id === t.project_id && p.status !== 'archived',
                          ),
                      ).length
                    }
                  </span>
                </td>
                <td>
                  <span className={`project-state ${m.active ? 'active' : 'paused'}`}>
                    {m.active ? 'Активен' : 'Отключён'}
                  </span>
                </td>
                {owner && (
                  <td>
                    {m.role !== 'owner' && (
                      <button
                        className="text-btn"
                        onClick={() => {
                          if (
                            window.confirm(
                              m.active
                                ? `Отключить доступ ${m.name}? Активные сеансы и MCP-токены будут отозваны.`
                                : `Восстановить доступ ${m.name}?`,
                            )
                          )
                            void mutate(`/members/${m.id}`, 'PATCH', { active: !m.active })
                              .then(() => notify('Доступ обновлён'))
                              .catch((e: Error) => setError(e.message));
                        }}
                      >
                        {m.active ? 'Отключить' : 'Восстановить'}
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {owner && invites.length > 0 && (
        <section className="panel pending-invites">
          <h2>
            Ожидают приглашения <span>{invites.length}</span>
          </h2>
          {invites.map((i) => (
            <div key={i.id}>
              <span>{i.email}</span>
              <small>Действует до {dateLabel(i.expires_at.slice(0, 10))}</small>
              <button
                className="text-btn danger"
                onClick={async () => {
                  try {
                    await api(`/invites/${i.id}`, 'DELETE');
                    refresh();
                    notify('Приглашение отозвано');
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                Отозвать
              </button>
            </div>
          ))}
        </section>
      )}
    </>
  );
}

type Token = {
  id: string;
  name: string;
  scope: 'read' | 'write';
  last_used_at: string | null;
  created_at: string;
};
function Integrations({ notify }: { notify: Toast }) {
  const [tokens, setTokens] = useState<Token[]>([]),
    [created, setCreated] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const refresh = () =>
    api<Token[]>('/tokens')
      .then(setTokens)
      .catch((e) => setError(e.message));
  useEffect(() => {
    void refresh();
  }, []);
  const config = JSON.stringify(
    {
      mcpServers: {
        freejira: {
          url: `${location.origin}/mcp`,
          headers: { Authorization: `Bearer ${created || 'YOUR_FREEJIRA_TOKEN'}` },
        },
      },
    },
    null,
    2,
  );
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setBusy(true);
    const f = new FormData(e.currentTarget);
    try {
      const r = await api('/tokens', 'POST', { name: f.get('name'), scope: f.get('scope') });
      setCreated(r.token);
      await refresh();
      notify('Токен создан');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeader
        eyebrow="ЕЩЁ ОДИН УЧАСТНИК КОМАНДЫ"
        title="MCP и AI"
        description="Дайте ассистенту контекст проектов и возможность помогать с настоящей работой."
      />
      <section className="mcp-hero">
        <div className="mcp-logo">
          <Bot size={34} />
        </div>
        <div>
          <span className="mcp-badge">
            <i /> MCP SERVER
          </span>
          <h2>Ваши проекты говорят на языке AI</h2>
          <p>
            Планируйте спринты, находите блокеры и обновляйте задачи через AI-ассистента. Все
            изменения видны команде в реальном времени.
          </p>
          <div className="mcp-features">
            <span>
              <Check size={13} /> 11 инструментов
            </span>
            <span>
              <Check size={13} /> Общие данные
            </span>
            <span>
              <Check size={13} /> История изменений
            </span>
          </div>
        </div>
      </section>
      <div className="integration-grid">
        <section className="panel settings-panel">
          <div className="step-label">
            01 <span>СОЗДАЙТЕ ДОСТУП</span>
          </div>
          <h2>Личный токен</h2>
          <p className="muted">
            Действия AI выполняются от вашего имени. Доступ можно отозвать в любой момент.
          </p>
          <form onSubmit={create}>
            <label>
              Название подключения
              <input
                name="name"
                placeholder="Например, Cursor или Claude"
                maxLength={80}
                required
              />
            </label>
            <label>
              Права
              <select name="scope" defaultValue="write">
                <option value="write">Чтение и редактирование</option>
                <option value="read">Только чтение</option>
              </select>
            </label>
            <Button className="btn primary" type="submit" busy={busy}>
              <Plus size={16} /> Создать токен
            </Button>
          </form>
          {created && (
            <div className="token-result">
              <strong>Сохраните токен сейчас</strong>
              <p>После закрытия страницы он больше не будет показан.</p>
              <div className="secret-value">
                <code>{created}</code>
                <button
                  className="icon-btn"
                  aria-label="Копировать токен"
                  onClick={() =>
                    navigator.clipboard
                      .writeText(created)
                      .then(() => notify('Токен скопирован'))
                      .catch(() => setError('Выделите и скопируйте токен вручную'))
                  }
                >
                  <Copy size={15} />
                </button>
              </div>
            </div>
          )}
          <ErrorMessage message={error} />
        </section>
        <section className="panel settings-panel">
          <div className="step-label">
            02 <span>ПОДКЛЮЧИТЕ АССИСТЕНТА</span>
          </div>
          <h2>Streamable HTTP</h2>
          <p className="muted">
            Укажите адрес сервера и заголовок Authorization в настройках MCP вашего клиента.
          </p>
          <div className="code-block">
            <div>
              <span>
                <Code2 size={13} /> MCP configuration
              </span>
              <button
                className="icon-btn"
                title="Копировать конфигурацию"
                onClick={() =>
                  navigator.clipboard
                    .writeText(config)
                    .then(() => notify('Конфигурация скопирована'))
                    .catch(() => setError('Выделите конфигурацию и скопируйте вручную'))
                }
              >
                <Copy size={14} />
              </button>
            </div>
            <pre>{config}</pre>
          </div>
          <p className="small-text muted">
            Клиенту нужны поддержка HTTP MCP и пользовательских заголовков. Для stdio-клиентов в
            проекте есть команда <code>npm run mcp</code> и инструкция в README.
          </p>
        </section>
      </div>
      <section className="panel token-list">
        <div className="panel-header">
          <h2>
            Активные подключения <span>{tokens.length}</span>
          </h2>
          <ShieldCheck size={17} />
        </div>
        {tokens.length ? (
          tokens.map((t) => (
            <div className="token-row" key={t.id}>
              <span className="token-icon">
                <Bot size={19} />
              </span>
              <div>
                <strong>{t.name}</strong>
                <small>
                  {t.scope === 'read' ? 'Только чтение' : 'Чтение и редактирование'} ·{' '}
                  {t.last_used_at
                    ? `Последний запрос ${timeLabel(t.last_used_at)}`
                    : 'Ещё не использовался'}
                </small>
              </div>
              <button
                className="text-btn danger"
                onClick={async () => {
                  if (!window.confirm(`Отозвать токен «${t.name}»?`)) return;
                  try {
                    await api(`/tokens/${t.id}`, 'DELETE');
                    setCreated('');
                    await refresh();
                    notify('Токен отозван');
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                Отозвать
              </button>
            </div>
          ))
        ) : (
          <div className="panel-empty">Пока нет подключений. Создайте первый токен выше.</div>
        )}
      </section>
      <div className="prompt-examples">
        <span className="section-kicker">ПОПРОБУЙТЕ СПРОСИТЬ У АССИСТЕНТА</span>
        <div>
          {[
            'Какие задачи просрочены во всех проектах?',
            'Создай план запуска продукта на две недели',
            'Подготовь сводку прогресса для команды',
          ].map((s) => (
            <button
              key={s}
              onClick={() =>
                navigator.clipboard
                  .writeText(s)
                  .then(() => notify('Запрос скопирован'))
                  .catch(() => notify('Не удалось скопировать'))
              }
            >
              <Sparkles size={15} />
              {s}
              <Copy size={12} />
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

function Settings({ data, mutate, notify }: { data: Snapshot; mutate: Function; notify: Toast }) {
  const [error, setError] = useState(''),
    [busy, setBusy] = useState('');
  async function submit(e: FormEvent<HTMLFormElement>, path: string) {
    e.preventDefault();
    setError('');
    setBusy(path);
    const form = e.currentTarget,
      f = new FormData(form);
    try {
      await mutate(
        path,
        path.includes('password') ? 'POST' : 'PATCH',
        Object.fromEntries(f.entries()),
      );
      notify('Настройки сохранены');
      if (path.includes('password')) form.reset();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  return (
    <>
      <PageHeader
        eyebrow="ВАШЕ ПРОСТРАНСТВО"
        title="Настройки"
        description="Личный профиль, команда и сохранность данных."
      />
      <ErrorMessage message={error} />
      <div className="settings-grid">
        <section className="panel settings-panel">
          <h2>Личный профиль</h2>
          <div className="profile-preview">
            <Avatar user={data.user} size="large" />
            <div>
              <strong>{data.user.name}</strong>
              <p>{data.user.email}</p>
            </div>
          </div>
          <form onSubmit={(e) => void submit(e, '/profile')}>
            <label>
              Ваше имя
              <input name="name" defaultValue={data.user.name} required maxLength={80} />
            </label>
            <Button className="btn" busy={busy === '/profile'} type="submit">
              Сохранить профиль
            </Button>
          </form>
        </section>
        {data.user.role === 'owner' && (
          <section className="panel settings-panel">
            <h2>Рабочее пространство</h2>
            <p className="muted">Название видно всем участникам команды.</p>
            <form onSubmit={(e) => void submit(e, '/workspace')}>
              <label>
                Название
                <input name="name" defaultValue={data.workspace.name} required maxLength={80} />
              </label>
              <Button className="btn" busy={busy === '/workspace'} type="submit">
                Сохранить название
              </Button>
            </form>
          </section>
        )}
        <section className="panel settings-panel">
          <h2>Безопасность</h2>
          <p className="muted">При смене пароля другие сеансы будут завершены.</p>
          <form onSubmit={(e) => void submit(e, '/profile/password')}>
            <label>
              Текущий пароль
              <input
                name="current"
                type="password"
                autoComplete="current-password"
                required
                maxLength={128}
              />
            </label>
            <label>
              Новый пароль
              <input
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={10}
                maxLength={128}
                placeholder="Не меньше 10 символов"
                required
              />
            </label>
            <Button className="btn" busy={busy === '/profile/password'} type="submit">
              Обновить пароль
            </Button>
          </form>
        </section>
        <section className="panel settings-panel">
          <h2>Ваши данные с вами</h2>
          <p className="muted">
            Скачайте проекты, задачи, комментарии и историю в JSON. Пароли, сеансы и токены в
            экспорт не входят.
          </p>
          <a className="btn" href="/api/export" download>
            <Download size={16} /> Экспортировать данные
          </a>
          <div className="settings-info">
            <ShieldCheck size={18} />
            <span>
              Для полного восстановления сервера используйте резервную копию SQLite. Инструкция и
              команда — в README проекта.
            </span>
          </div>
        </section>
      </div>
    </>
  );
}
function GlobalSearch({
  data,
  close,
  navigate,
  openTask,
}: {
  data: Snapshot;
  close: () => void;
  navigate: Navigate;
  openTask: (t: Task) => void;
}) {
  const [q, setQ] = useState('');
  const text = q.toLowerCase();
  const projects = data.projects
    .filter((p) => `${p.name} ${p.key}`.toLowerCase().includes(text))
    .slice(0, 5);
  const tasks = data.tasks
    .filter((t) =>
      `${t.title} ${t.description} ${data.projects.find((p) => p.id === t.project_id)?.key}-${t.number}`
        .toLowerCase()
        .includes(text),
    )
    .slice(0, 12);
  return (
    <Modal title="Поиск по пространству" onClose={close}>
      <div className="search-modal">
        <div className="input-icon">
          <Search size={18} />
          <input
            autoFocus
            placeholder="Проект, задача, код или описание…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Глобальный поиск"
          />
        </div>
        <div className="search-results">
          {projects.length > 0 && (
            <>
              <span className="section-kicker">ПРОЕКТЫ</span>
              {projects.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    navigate(`project/${p.id}`);
                    close();
                  }}
                >
                  <span
                    className="project-symbol small"
                    style={{ background: `${p.color}20`, color: p.color }}
                  >
                    <FolderKanban size={17} />
                  </span>
                  <span>
                    {p.name}
                    <small>
                      {p.key}
                      {p.status === 'archived' ? ' · Архив' : ''}
                    </small>
                  </span>
                  <ArrowUpRight size={14} />
                </button>
              ))}
            </>
          )}
          {tasks.length > 0 && (
            <>
              <span className="section-kicker">ЗАДАЧИ</span>
              {tasks.map((t) => (
                <button
                  key={t.id}
                  onClick={() => {
                    close();
                    openTask(t);
                  }}
                >
                  <StatusDot status={t.status} />
                  <span>
                    {t.title}
                    <small>
                      {data.projects.find((p) => p.id === t.project_id)?.key}-{t.number} ·{' '}
                      {STATUS_LABEL[t.status]}
                    </small>
                  </span>
                  <ArrowUpRight size={14} />
                </button>
              ))}
            </>
          )}
          {tasks.length + projects.length === 0 && (
            <Empty title="Ничего не найдено" text="Попробуйте другое название или код задачи." />
          )}
        </div>
        <div className="search-help">
          <kbd>ESC</kbd> закрыть <span>Поиск по всем проектам, включая архив</span>
        </div>
      </div>
    </Modal>
  );
}
