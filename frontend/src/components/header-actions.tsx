import { ExternalLinkIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useSession } from "@/lib/auth"

/** 顶栏右侧常驻件：返回来源应用（会话下发 appHomeUrl，文案随租户语境可配）。 */
export default function HeaderActions() {
  const { data: session } = useSession()
  if (!session?.appHomeUrl) return null
  return (
    <Button asChild variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-xs text-muted-foreground">
      <a href={session.appHomeUrl}>
        <ExternalLinkIcon />
        {session.appHomeLabel ?? "返回应用"}
      </a>
    </Button>
  )
}
