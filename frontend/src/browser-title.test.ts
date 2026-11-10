import { readFileSync } from "node:fs"
import { createServer } from "vite"
import { join } from "node:path"
import { expect, it } from "vitest"

it("uses the registered account-center title in the initial application document", async () => {
  const server = await createServer({ root: join(__dirname, ".."), server: { middlewareMode: true } })
  try {
    const html = await server.transformIndexHtml("/me/", readFileSync(join(__dirname, "../index.html"), "utf8"))
    expect(html.match(/<title>(.*?)<\/title>/)?.[1]).toBe("PandaAuth 账户中心 | Panda Labs")
  } finally { await server.close() }
})
