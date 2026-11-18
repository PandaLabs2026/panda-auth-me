import { useContext, useEffect, useRef, useState } from "react"
import { Link, useBlocker } from "react-router"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useI18n } from "@/lib/i18n"
import { meAuthLifecycle } from "@/lib/auth-lifecycle"
import { profileApi, ProfileRequestError, type SelfProfile } from "@/lib/profile-api"
import { ProfilePresentationContext } from "@/lib/profile-presentation"

type TextField = "name" | "bio"
type Section = "page" | "basics" | "avatar" | "contact"

export default function ProfileEditPage() {
  const { t, locale } = useI18n()
  const { confirmProfile, loginEmail, displayName } = useContext(ProfilePresentationContext)
  const [profile, setProfile] = useState<SelfProfile | null>(null)
  const [name, setName] = useState("")
  const [bio, setBio] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [conflict, setConflict] = useState(false)
  const [overlaps, setOverlaps] = useState<TextField[]>([])
  const [invalidField, setInvalidField] = useState<TextField | null>(null)
  const [section, setSection] = useState<Section>("page")
  const [uncertain, setUncertain] = useState(false)
  const [avatar, setAvatar] = useState<File | null>(null)
  const [preview, setPreview] = useState("")
  const [address, setAddress] = useState("")
  const [challenge, setChallenge] = useState("")
  const [token, setToken] = useState("")
  const [expiredAt, setExpiredAt] = useState("")
  const generation = useRef(0)
  const avatarInput = useRef<HTMLInputElement>(null)
  const avatarSelection = useRef(0)
  const pending = profile?.contactEmail.pendingVerification
  const activeChallenge = pending
    ? pending.expiresAt === expiredAt ? "" : pending.challengeId
    : challenge
  const nameDirty = profile !== null && name !== (profile.displayName ?? "")
  const bioDirty = profile !== null && bio !== (profile.biography ?? "")
  const textDirty = nameDirty || bioDirty
  const dirty = uncertain || textDirty || avatar !== null || (address !== "" && address !== profile?.contactEmail.address) || token !== ""
  const writeBlocked = busy || conflict || uncertain
  const blocker = useBlocker(dirty && !meAuthLifecycle.paused())
  useEffect(() => {
    if (blocker.state !== "blocked") return
    if (window.confirm(t("离开将丢弃未保存的个人资料，是否继续？"))) blocker.proceed()
    else blocker.reset()
  }, [blocker, t])

  function loadValues(value: SelfProfile, preserveDraft = false) {
    setProfile(value)
    confirmProfile?.(value)
    if (!preserveDraft || !nameDirty) setName(value.displayName ?? "")
    if (!preserveDraft || !bioDirty) setBio(value.biography ?? "")
  }
  function failure(reason: unknown, write = false) {
    setNotice("")
    const status = reason instanceof ProfileRequestError ? reason.status : 0
    const code = reason instanceof ProfileRequestError ? reason.code : ""
    if (write && (status === 0 || status >= 500)) setUncertain(true)
    setConflict(status === 412 || status === 428)
    setError(status === 412 ? "资料已在其他位置更新，请重新读取后确认提交。草稿已保留。"
      : status === 404 ? "个人资料编辑暂不可用"
      : status === 403 ? "当前账户没有资料编辑权限"
      : status === 401 ? "登录状态已变化，请重新认证"
      : status === 429 ? "操作过于频繁，请稍后重试"
      : code === "contact_delivery_unconfirmed" ? "邮件投递结果未确认。请重新读取资料后再决定是否重发。"
      : status === 422 && code === "contact_challenge_invalid" ? "验证令牌无效或已过期，请核对或重新发送验证邮件"
      : status === 422 ? "资料内容不符合要求，请检查后重试"
      : status === 413 ? "提交内容过大，请缩小后重试"
      : status === 400 || status === 428 ? "请求未获接受，请重新读取资料后再试"
      : "操作结果未确认，请重新读取资料后再试。草稿已保留。")
  }
  async function reload(preserveDraft = true) {
    const current = generation.current
    setSection("page")
    setBusy(true); setError(""); setNotice(""); setInvalidField(null)
    try {
      const value = await profileApi.read()
      if (generation.current !== current) return
      setOverlaps(previous => {
        if (!preserveDraft || !profile) return []
        const merged: TextField[] = []
        if (nameDirty && name !== (value.displayName ?? "")
            && (previous.includes("name") || profile.displayName !== value.displayName)) merged.push("name")
        if (bioDirty && bio !== (value.biography ?? "")
            && (previous.includes("bio") || profile.biography !== value.biography)) merged.push("bio")
        return merged
      })
      loadValues(value, preserveDraft)
      setChallenge(""); setToken("")
      setConflict(false)
      setUncertain(false)
    } catch (reason) { if (generation.current === current) failure(reason) }
    finally { if (generation.current === current) setBusy(false) }
  }
  useEffect(() => {
    const retire = () => { generation.current++ }
    void reload(false)
    const off = meAuthLifecycle.subscribe(() => {
      if (!meAuthLifecycle.paused()) return
      retire()
      setProfile(null); setName(""); setBio(""); setNotice(""); setBusy(false)
      setAvatar(null); setPreview(""); setAddress(""); setChallenge(""); setToken("")
      setOverlaps([]); setSection("page")
      setUncertain(false)
      setError("登录状态已变化，请重新认证")
    })
    return () => { retire(); off() }
    // Mount loads once; changes to the authenticated actor remount the business tree.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (!pending) return
    const expiry = pending.expiresAt
    const remaining = Date.parse(expiry) - Date.now()
    const timer = window.setTimeout(() => setExpiredAt(expiry), Math.max(0, Math.min(remaining, 2_147_483_647)))
    return () => window.clearTimeout(timer)
  }, [pending])
  useEffect(() => {
    if (!dirty) return
    const release = meAuthLifecycle.protect(t("有未保存的个人资料"))
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = "" }
    window.addEventListener("beforeunload", prevent)
    return () => { release(); window.removeEventListener("beforeunload", prevent) }
  }, [dirty, t])

  async function save() {
    if (!profile || writeBlocked || !textDirty || overlaps.length > 0) return
    setSection("basics")
    const invalidName = nameDirty && ([...name.trim()].length < 1 || [...name.trim()].length > 80)
    const invalidBio = bioDirty && [...bio].length > 1000
    if (invalidName || invalidBio) {
      setNotice(""); setInvalidField(invalidName ? "name" : "bio")
      setError(invalidName ? "名称须为 1–80 个字符。" : "简介最多 1000 个字符。")
      return
    }
    if (!confirmVerificationInvalidation()) return
    const patch: { displayName?: string; biography?: string | null } = {}
    if (nameDirty) patch.displayName = name.trim()
    if (bioDirty) patch.biography = bio || null
    const current = generation.current
    setBusy(true); setError(""); setNotice(""); setInvalidField(null)
    try {
      const value = await profileApi.patch(patch, profile.revision)
      if (generation.current !== current) return
      loadValues(value); setChallenge(""); setToken(""); setNotice("资料已保存")
    } catch (reason) { if (generation.current === current) failure(reason, true) }
    finally { if (generation.current === current) setBusy(false) }
  }

  function confirmVerificationInvalidation() {
    return !activeChallenge || window.confirm(t("保存此更改会使当前邮箱验证码失效。仍要继续吗？"))
  }

  async function mutate(operation: () => Promise<SelfProfile>, message: string, options: { keepChallenge?: boolean; clearAvatar?: boolean; section?: Section } = {}) {
    if (writeBlocked) return
    const current = generation.current
    setSection(options.section ?? "contact")
    setBusy(true); setError(""); setNotice("")
    try {
      const value = await operation()
      if (generation.current !== current) return
      setProfile(value); confirmProfile?.(value); setNotice(message)
      if (!options.keepChallenge) { setChallenge(""); setToken("") }
      if (options.clearAvatar) {
        setAvatar(null); setPreview("")
        if (avatarInput.current) avatarInput.current.value = ""
      }
    } catch (reason) { if (generation.current === current) failure(reason, true) }
    finally { if (generation.current === current) setBusy(false) }
  }
  function chooseAvatar(file?: File) {
    const selection = ++avatarSelection.current
    setAvatar(null); setPreview(""); setError(""); setNotice(""); setSection("avatar")
    if (!file) return
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 2 * 1024 * 1024) {
      setError("头像须为 JPEG、PNG 或 WebP，且不超过 2 MiB"); return
    }
    setAvatar(file)
    const current = generation.current
    const reader = new FileReader()
    reader.onload = () => {
      if (generation.current === current && avatarSelection.current === selection && typeof reader.result === "string") setPreview(reader.result)
    }
    reader.readAsDataURL(file)
  }
  async function sendContact(destination: string) {
    if (!profile || !destination) return
    const current = generation.current
    await mutate(async () => {
      const result = await profileApi.createChallenge(destination, profile.revision)
      if (generation.current === current) {
        setChallenge(result.challengeId); setToken(""); setAddress("")
      }
      return result.profile
    }, "验证邮件已发送，请输入邮件中的验证令牌", { keepChallenge: true })
  }

  function feedback(target: Section) {
    if (section !== target) return null
    return <>
      {error && <p id={`profile-${target}-error`} role="alert" className="text-destructive">{t(error)}</p>}
      {notice && <p role="status">{t(notice)}</p>}
      {(error || conflict) && <Button type="button" disabled={busy} onClick={() => void reload()} variant="outline">{t("重新读取资料")}</Button>}
    </>
  }

  function conflictChoices(field: TextField, draft: string, saved: string) {
    if (!overlaps.includes(field)) return null
    const resolve = () => setOverlaps(fields => fields.filter(value => value !== field))
    return <div className="space-y-2 rounded-md border p-3">
      <dl className="grid gap-2 break-words sm:grid-cols-2">
        <div><dt className="font-medium">{t("我的修改")}</dt><dd className="whitespace-pre-wrap">{draft || t("空白")}</dd></div>
        <div><dt className="font-medium">{t("当前已保存")}</dt><dd className="whitespace-pre-wrap">{saved || t("空白")}</dd></div>
      </dl>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={busy} onClick={resolve}>{t("保留我的修改")}</Button>
        <Button type="button" variant="ghost" disabled={busy} onClick={() => {
          if (field === "name") setName(saved)
          else setBio(saved)
          resolve()
        }}>{t("采用已保存的值")}</Button>
      </div>
    </div>
  }

  return <div className="mx-auto w-full max-w-3xl space-y-5">
    <div className="space-y-2">
      <h1 className="text-2xl font-semibold">{t("个人资料")}</h1>
      {loginEmail && <p className="break-words text-sm">{t("当前账号")} · {displayName && `${displayName} · `}{loginEmail}</p>}
      <p className="text-sm text-muted-foreground">{t("这些资料仅本人可见。登录邮箱和安全设置独立管理。")}</p>
      <Button asChild variant="ghost"><Link to="/">{t("返回账户总览")}</Link></Button>
    </div>
    {feedback("page")}
    {busy && !profile && <p role="status">{t("正在读取个人资料")}</p>}
    {profile && <>
    <Card><CardHeader><CardTitle>{t("头像")}</CardTitle></CardHeader><CardContent className="space-y-4">
      {(preview || profile.hasAvatar) && <img key={profile.revision + preview} src={preview || "/me/api/profile/avatar"} alt={t("个人头像")} className="size-20 rounded-full object-cover"/>}
      <p>{t("JPEG、PNG 或 WebP，最多 2 MiB。图片将由服务器规范化处理。")}</p>
      <label htmlFor="profile-avatar" hidden>{t("选择头像")}</label>
      <input ref={avatarInput} id="profile-avatar" type="file" accept="image/jpeg,image/png,image/webp" hidden disabled={busy} onChange={event => chooseAvatar(event.target.files?.[0])}/>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={busy} onClick={() => avatarInput.current?.click()}>{t("选择图片")}</Button>
        <Button disabled={writeBlocked || !avatar} onClick={() => avatar && confirmVerificationInvalidation() && void mutate(() => profileApi.uploadAvatar(avatar, profile.revision), "头像已保存", { clearAvatar: true, section: "avatar" })}>{t("上传头像")}</Button>
        <Button variant="outline" disabled={writeBlocked || !profile.hasAvatar} onClick={() => {
          if (window.confirm(t("确定删除头像？")) && confirmVerificationInvalidation()) void mutate(() => profileApi.deleteAvatar(profile.revision), "头像已删除", { clearAvatar: true, section: "avatar" })
        }}>{t("删除头像")}</Button>
      </div>
      {feedback("avatar")}
    </CardContent></Card>
    <Card>
      <CardHeader><CardTitle>{t("基本资料")}</CardTitle></CardHeader>
      <CardContent><form className="space-y-4" onSubmit={event => { event.preventDefault(); void save() }}>
        <div className="space-y-2"><label htmlFor="profile-name">{t("名称")}</label><Input id="profile-name" value={name} disabled={busy}
          aria-invalid={invalidField === "name" || undefined} aria-describedby={invalidField === "name" ? "profile-basics-error" : undefined}
          onChange={event => setName(event.target.value)} autoComplete="nickname"/></div>
        {conflictChoices("name", name, profile.displayName ?? "")}
        <div className="space-y-2"><label htmlFor="profile-bio">{t("简介")}</label><Textarea id="profile-bio" className="min-h-28" value={bio} disabled={busy}
          aria-invalid={invalidField === "bio" || undefined} aria-describedby={invalidField === "bio" ? "profile-basics-error" : undefined}
          onChange={event => setBio(event.target.value)}/></div>
        {conflictChoices("bio", bio, profile.biography ?? "")}
        <div className="flex flex-wrap gap-2"><Button type="submit" disabled={writeBlocked || !textDirty || overlaps.length > 0}>{t("保存基本资料")}</Button>
          <Button type="button" variant="outline" disabled={busy || !textDirty} onClick={() => {
            setName(profile.displayName ?? ""); setBio(profile.biography ?? ""); setOverlaps([])
          }}>{t("取消编辑")}</Button></div>
        {feedback("basics")}
      </form></CardContent>
    </Card>
    <Card><CardHeader><CardTitle>{t("联系邮箱")}</CardTitle></CardHeader><CardContent className="space-y-4">
      <p>{t("联系邮箱独立于登录邮箱和找回渠道，不会改变登录凭据。")}</p>
      <p className="break-words">{profile.contactEmail.address} <span>{t(profile.contactEmail.state === "verified" ? "已验证" : profile.contactEmail.state === "pending" ? "等待验证" : "未设置联系邮箱")}</span></p>
      <form className="space-y-3" onSubmit={event => { event.preventDefault(); void sendContact(address) }}>
        <label htmlFor="profile-contact">{t("联系邮箱")}</label><Input id="profile-contact" type="email" autoComplete="email" value={address} disabled={busy} required onChange={event => setAddress(event.target.value)}/>
        <Button disabled={writeBlocked}>{t("发送验证邮件")}</Button>
      </form>
      {activeChallenge && <form className="space-y-3" onSubmit={event => { event.preventDefault(); void mutate(() => profileApi.confirmContact(activeChallenge, token), "联系邮箱已验证") }}>
        {pending && <p>{t("验证码有效至")} <time dateTime={pending.expiresAt}>{new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(pending.expiresAt))}</time></p>}
        <label htmlFor="profile-contact-token">{t("邮件中的验证令牌")}</label><Input id="profile-contact-token" autoComplete="off" autoCapitalize="none" spellCheck={false} value={token} disabled={busy} required onChange={event => setToken(event.target.value)}/>
        <Button disabled={writeBlocked || !token}>{t("确认联系邮箱")}</Button>
      </form>}
      {profile.contactEmail.state === "pending" && !activeChallenge && <p>{t("请重新发送验证邮件以开始本次确认。")}</p>}
      <div className="flex flex-wrap gap-2">
        {profile.contactEmail.state === "pending" && profile.contactEmail.address && <Button variant="outline" disabled={writeBlocked} onClick={() => void sendContact(profile.contactEmail.address!)}>{t("重新发送验证邮件")}</Button>}
        <Button variant="outline" disabled={writeBlocked || profile.contactEmail.state === "none"} onClick={() => { if (window.confirm(t("确定删除联系邮箱及未完成的验证？"))) void mutate(() => profileApi.deleteContact(profile.revision), "联系邮箱已删除") }}>{t("删除联系邮箱")}</Button>
      </div>
      {feedback("contact")}
    </CardContent></Card></>}
  </div>
}
