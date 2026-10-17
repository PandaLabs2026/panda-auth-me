import "@testing-library/jest-dom/vitest"

import { afterEach } from "vitest"
import { cleanup } from "@testing-library/react"

// jsdom 未实现 matchMedia(sidebar/command 等组件用到);restoreMocks 下
// 不能用 vi.fn() 会话级 stub,故手写实现(模板/fleet-admin 先例)。
afterEach(() => cleanup())

if (!window.matchMedia) {
  window.matchMedia = ((query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList) as unknown as typeof window.matchMedia
}

// jsdom 未实现 scrollTo(真实浏览器存在);补最小 no-op stub,语义为零滚动。
if (!window.scrollTo) window.scrollTo = () => {}
if (!Element.prototype.scrollTo) Element.prototype.scrollTo = () => {}

// 钉死测试语言为 zh-CN:既有用例断言中文文案,屏蔽 navigator 检测带来的不确定性。
localStorage.setItem("panda.me.lang", "zh-CN")
