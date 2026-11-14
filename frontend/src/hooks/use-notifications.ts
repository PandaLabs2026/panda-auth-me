import { useCallback, useEffect, useSyncExternalStore } from 'react';

/**
 * 通知中心（v0.5.0）：内存 store + 轮询拉取的最小正典。真实接法=把 fetch 换成
 * BFF 的 /api/notifications（Envelope 契约），已读回写同理；UI 侧（铃铛/面板/页面）
 * 不变。通知属应用层数据：身份类消息（密码改登提醒等）归 IDP，勿塞这里。
 *
 * store 是模块级共享的：所有 useNotifications 实例（顶栏铃铛、通知中心页、面板内
 * 区块等）读同一份状态，任一实例的已读操作即时同步到全部视图。已读标记一旦发生
 * 不被轮询拉回（按 id 合并种子）；整页刷新（模块重载）回到种子态；实例全部卸载
 * 不清空状态，重新挂载接续。
 */
export interface AppNotification {
  id: string;
  title: string;
  body?: string;
  /** ISO 时间。 */
  at: string;
  level: 'info' | 'success' | 'warning';
  read: boolean;
}

/** 演示数据源：真实应用替换为 useApiQuery('/api/notifications', { refetchInterval })。 */
const seed: AppNotification[] = [
  { id: 'n1', title: '系统维护通知', body: '本周六 02:00–03:00 例行维护，期间服务短暂不可用。', at: '2026-10-15T09:00:00Z', level: 'warning', read: false },
  { id: 'n2', title: '备份完成', body: '每日数据库备份已完成并通过结构校验。', at: '2026-10-15T03:12:00Z', level: 'success', read: false },
  { id: 'n3', title: '新成员加入', body: '一位新成员接受了邀请加入工作区。', at: '2026-10-14T11:30:00Z', level: 'info', read: true },
];

export interface NotificationsApi {
  items: AppNotification[];
  unread: number;
  loading: boolean;
  markRead(id: string): void;
  markAllRead(): void;
}

interface StoreState {
  items: AppNotification[];
  unread: number;
  loading: boolean;
}

let state: StoreState = { items: [], unread: 0, loading: true };
const listeners = new Set<() => void>();
let pollTimer: ReturnType<typeof setInterval> | null = null;
let pollRefCount = 0;

function emit(next: StoreState): void {
  state = next;
  for (const listener of listeners) listener();
}

function snapshotEqual(a: StoreState, b: StoreState): boolean {
  return a.loading === b.loading && a.unread === b.unread && a.items.length === b.items.length
    && a.items.every((n, i) => n.id === b.items[i]?.id && n.read === b.items[i]?.read
      && n.title === b.items[i]?.title && n.body === b.items[i]?.body && n.at === b.items[i]?.at && n.level === b.items[i]?.level);
}

// 首拉 + 30s 轮询共用:按 id 合并种子,已读标记不被拉回(演示数据静态;真实接法以
// 后端权威态为准,合并策略属于真实适配层)。
function load(): void {
  const previous = new Map(state.items.map((n) => [n.id, n]));
  const items = seed.map((n) => {
    const prior = previous.get(n.id);
    return prior ? { ...n, read: n.read || prior.read } : { ...n };
  });
  const next: StoreState = { items, unread: items.filter((n) => !n.read).length, loading: false };
  if (!snapshotEqual(state, next)) emit(next);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function markReadAction(id: string): void {
  if (!state.items.some((n) => n.id === id && !n.read)) return;
  const items = state.items.map((n) => (n.id === id ? { ...n, read: true } : n));
  emit({ items, unread: items.filter((n) => !n.read).length, loading: false });
}

function markAllReadAction(): void {
  if (state.unread === 0) return;
  const items = state.items.map((n) => ({ ...n, read: true }));
  emit({ items, unread: 0, loading: false });
}

export function useNotifications(): NotificationsApi {
  const snapshot = useSyncExternalStore(subscribe, () => state, () => state);

  // 首个实例触发首拉;轮询按存活实例引用计数,全部卸载即停(状态保留)。
  useEffect(() => {
    load();
    pollRefCount += 1;
    if (pollRefCount === 1) pollTimer = setInterval(load, 30_000);
    return () => {
      pollRefCount -= 1;
      if (pollRefCount === 0 && pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    };
  }, []);

  const markRead = useCallback((id: string) => markReadAction(id), []);
  const markAllRead = useCallback(() => markAllReadAction(), []);

  return { items: snapshot.items, unread: snapshot.unread, loading: snapshot.loading, markRead, markAllRead };
}
