import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { useNotifications as UseNotifications } from './use-notifications';

// 通知 store 契约:种子加载、未读计数、单条/全部已读、双视图共享同步、
// 30s 轮询保留已读、卸载不清空(整页刷新回种子属模块重载语义,由契约文案承担)。

describe('useNotifications', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  // store 是模块级共享的:每个用例经 resetModules 取全新模块,互不串扰。
  async function freshHook(): Promise<typeof UseNotifications> {
    vi.resetModules();
    return (await import('./use-notifications')).useNotifications;
  }

  test('加载种子并统计未读', async () => {
    const useNotifications = await freshHook();
    const { result } = renderHook(() => useNotifications());
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(result.current.loading).toBe(false);
    expect(result.current.items.length).toBeGreaterThan(0);
    expect(result.current.unread).toBe(2);
  });

  test('单条已读降低未读数;全部已读清零', async () => {
    const useNotifications = await freshHook();
    const { result } = renderHook(() => useNotifications());
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    const first = result.current.items.find((n) => !n.read)!;
    const before = result.current.unread;
    act(() => result.current.markRead(first.id));
    expect(result.current.unread).toBe(before - 1);
    act(() => result.current.markAllRead());
    expect(result.current.unread).toBe(0);
    expect(result.current.items.every((n) => n.read)).toBe(true);
  });

  test('双视图共享:任一视图标读,另一视图即时同步', async () => {
    const useNotifications = await freshHook();
    const bell = renderHook(() => useNotifications());
    const page = renderHook(() => useNotifications());
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    const first = bell.result.current.items.find((n) => !n.read)!.id;
    expect(page.result.current.unread).toBe(2);
    act(() => page.result.current.markRead(first));
    expect(bell.result.current.unread).toBe(page.result.current.unread);
    expect(bell.result.current.items.find((n) => n.id === first)?.read).toBe(true);
    act(() => bell.result.current.markAllRead());
    expect(page.result.current.unread).toBe(0);
    expect(page.result.current.items.every((n) => n.read)).toBe(true);
  });

  test('计时回归:30s 轮询重播种不拉回已读标记', async () => {
    vi.useFakeTimers();
    const useNotifications = await freshHook();
    const { result } = renderHook(() => useNotifications());
    const first = result.current.items.find((n) => !n.read)!.id;
    act(() => result.current.markRead(first));
    expect(result.current.unread).toBe(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(result.current.unread).toBe(1);
    expect(result.current.items.find((n) => n.id === first)?.read).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(result.current.unread).toBe(1);
    expect(result.current.items.every((n) => n.id && n.at && n.title)).toBe(true);
  });

  test('实例全部卸载不清空状态,重新挂载接续', async () => {
    const useNotifications = await freshHook();
    const first = renderHook(() => useNotifications());
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    const target = first.result.current.items.find((n) => !n.read)!.id;
    act(() => first.result.current.markRead(target));
    expect(first.result.current.unread).toBe(1);
    first.unmount();
    const second = renderHook(() => useNotifications());
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(second.result.current.unread).toBe(1);
    expect(second.result.current.items.find((n) => n.id === target)?.read).toBe(true);
  });
});
