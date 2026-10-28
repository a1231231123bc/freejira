import { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, CheckCircle2, Loader2, ShieldCheck, Unplug } from 'lucide-react';
import { api, dateLabel } from './lib';
import './mcp.css';

type Connection = {
  id: string;
  name: string;
  scope: 'read' | 'tasks';
  created_at: string;
  last_used_at: string | null;
  expires_at: string;
  revoked_at: string | null;
};
type Pending = Pick<Connection, 'id' | 'name' | 'scope' | 'expires_at'> & {
  connected: boolean;
  pair_expires_at: string;
};
export function McpConnections() {
  const [connections, setConnections] = useState<Connection[]>([]),
    [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(''),
    [connected, setConnected] = useState(false),
    [loaded, setLoaded] = useState(false);
  const requestId = new URLSearchParams(location.search).get('connect');
  const approval = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (pending && !pending.connected) approval.current?.scrollIntoView({ block: 'center' });
  }, [pending?.id]);
  const refresh = useCallback(async () => {
    setError('');
    try {
      setConnections(await api('/mcp/connections'));
      if (requestId) setPending(await api(`/mcp/connections/${encodeURIComponent(requestId)}`));
      setLoaded(true);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [requestId]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  async function act(id: string, method: 'POST' | 'DELETE') {
    setBusy(id);
    setError('');
    try {
      await api(
        `/mcp/connections/${id}`,
        method,
        method === 'POST' ? { approve: true } : undefined,
      );
      if (method === 'DELETE') setConnected(false);
      if (id === requestId) {
        setPending(null);
        setConnected(method === 'POST');
        const url = new URL(location.href);
        url.searchParams.delete('connect');
        history.replaceState({}, '', url);
      }
      setConnections(await api('/mcp/connections'));
      setLoaded(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  const active = connections.filter(
    (c) => !c.revoked_at && c.expires_at > new Date().toISOString(),
  );
  return (
    <section className="panel settings-panel mcp-connections">
      <div className="mcp-section-heading">
        <Bot size={22} />
        <div>
          <h2>Claude Code</h2>
          <p className="muted">Прочитать задачу, внести изменения в код и обновить её статус.</p>
        </div>
      </div>
      {pending && !pending.connected && (
        <div
          ref={approval}
          className="mcp-approve"
          role="region"
          aria-label="Подтверждение подключения"
        >
          <span className="section-kicker">НОВОЕ ПОДКЛЮЧЕНИЕ</span>
          <h3>{pending.name}</h3>
          <p>
            {pending.scope === 'tasks'
              ? 'Разрешить читать проекты, задачи и кадры из видео, менять поля задач и оставлять комментарии от вашего имени.'
              : 'Разрешить читать проекты, задачи, комментарии и кадры из видео.'}
          </p>
          <small className="muted">
            Код подключения: {pending.id.slice(0, 8)} · Запрос действует до{' '}
            {new Date(pending.pair_expires_at).toLocaleTimeString('ru', {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </small>
          <div className="mcp-connect-actions">
            <button
              className="btn primary"
              disabled={!!busy}
              onClick={() => void act(pending.id, 'POST')}
            >
              {busy ? <Loader2 className="spin" size={16} /> : <ShieldCheck size={16} />}Подключить
              Claude Code
            </button>
            <button
              className="btn"
              disabled={!!busy}
              onClick={() => void act(pending.id, 'DELETE')}
            >
              Отклонить
            </button>
          </div>
        </div>
      )}
      {(connected || pending?.connected) && (
        <div className="settings-info" role="status">
          <CheckCircle2 size={20} />
          <span>
            Claude Code подключён. Вернитесь в терминал и откройте новый сеанс в папке нужного
            проекта.
          </span>
        </div>
      )}
      {error && (
        <div className="error" role="alert">
          {error}{' '}
          <button className="text-btn" onClick={() => void refresh()}>
            Повторить
          </button>
        </div>
      )}
      <div className="mcp-workflow">
        <div>
          <span>1</span>
          <strong>Взять задачу</strong>
          <p>Описание, комментарии и критерии готовности — из общей базы.</p>
        </div>
        <div>
          <span>2</span>
          <strong>Выполнить и проверить</strong>
          <p>Claude работает в открытом репозитории, задача — «В работе».</p>
        </div>
        <div>
          <span>3</span>
          <strong>Передать результат</strong>
          <p>Комментарий с изменениями и проверками, затем нужная колонка.</p>
        </div>
      </div>
      <div className="code-block">
        <div>
          <span>В Claude Code · замените DEMO-12 на вашу задачу</span>
        </div>
        <pre>/freejira-task DEMO-12 review</pre>
      </div>
      <p className="small-text muted">
        По умолчанию результат идёт «На проверке». Укажите done, если после успешных проверок задачу
        нужно завершить. Команда устанавливается при настройке подключения на компьютере.
      </p>
      <h3>Ваши подключения</h3>
      {!loaded && !error && <p className="muted">Загружаем подключения…</p>}
      {loaded && active.length === 0 && (
        <p className="muted">
          Подключений пока нет. При настройке на компьютере откройте ссылку подтверждения, которую
          покажет установщик.
        </p>
      )}
      <div className="mcp-connection-list">
        {active.map((c) => (
          <div className="mcp-connection-row" key={c.id}>
            <div>
              <strong>{c.name}</strong>
              <p>
                {c.scope === 'tasks' ? 'Чтение и работа с задачами' : 'Только чтение'} ·{' '}
                {c.last_used_at
                  ? `Использовано ${dateLabel(c.last_used_at.slice(0, 10))}`
                  : 'Ещё не использовано'}
              </p>
              <small className="muted">
                Действует до{' '}
                {new Date(c.expires_at).toLocaleDateString('ru', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })}
              </small>
            </div>
            <button
              className="btn"
              aria-label={`Отключить ${c.name}`}
              disabled={!!busy}
              onClick={() => void act(c.id, 'DELETE')}
            >
              <Unplug size={15} />
              Отключить
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
