import { readFileSync } from "node:fs"
import { join } from "node:path"
import { expect, it } from "vitest"

it("uses the registered account-center title in the initial application document", () => {
  const html = readFileSync(join(__dirname, "../index.html"), "utf8")
  expect(html.match(/<title>(.*?)<\/title>/)?.[1]).toBe("PandaAuth 账户中心 | Panda Labs")
})
