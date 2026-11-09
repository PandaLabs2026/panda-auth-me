import { useEffect, useRef, useState } from "react"
import { Link, useBlocker } from "react-router"
import PageHeader from "@/components/patterns/PageHeader"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useI18n } from "@/lib/i18n"
import { meAuthLifecycle } from "@/lib/auth-lifecycle"
import { profileApi, ProfileRequestError, type SelfProfile } from "@/lib/profile-api"

export default function ProfileEditPage() {
  const { t } = useI18n()
  const [profile, setProfile] = useState<SelfProfile | null>(null)
  const [name, setName] = useState("")
  const [bio, setBio] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [conflict, setConflict] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const [avatar, setAvatar] = useState<File | null>(null)
  const [preview, setPreview] = useState("")
  const [address, setAddress] = useState("")
  const [challenge, setChallenge] = useState("")
  const [token, setToken] = useState("")
  const generation = useRef(0)
  const textDirty = profile !== null && (name !== (profile.displayName ?? "") || bio !== (profile.biography ?? ""))
  const dirty = uncertain || textDirty || avatar !== null || (address !== "" && address !== profile?.contactEmail.address) || token !== ""
  const writeBlocked = busy || conflict || uncertain
  const blocker = useBlocker(dirty && !meAuthLifecycle.paused())
  useEffect(() => {
    if (blocker.state !== "blocked") return
    if (window.confirm(t("离开将丢弃未保存的个人资料，是否继续？"))) blocker.proceed()
    else blocker.reset()
  }, [blocker, t])

  function loadValues(value: SelfProfile) {
    setProfile(value); setName(value.displayName ?? ""); setBio(value.biography ?? "")
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
      : status === 422 && code === "contact_challenge_invalid" ? "验证令牌无效或已过期，请核对或重新发送验证邮件"
      : status === 422 ? "资料内容不符合要求，请检查后重试"
      : status === 413 ? "提交内容过大，请缩小后重试"
      : status === 400 || status === 428 ? "请求未获接受，请重新读取资料后再试"
      : "操作结果未确认，请重新读取资料后再试。草稿已保留。")
  }
  async function reload(preserveDraft = true) {
    const current = generation.current
    setBusy(true); setError(""); setNotice("")
    try {
      const value = await profileApi.read()
      if (generation.current !== current) return
      if (preserveDraft && dirty) setProfile(value)
      else loadValues(value)
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
      setUncertain(false)
      setError("登录状态已变化，请重新认证")
    })
    return () => { retire(); off() }
    // Mount loads once; changes to the authenticated actor remount the business tree.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (!dirty) return
    const release = meAuthLifecycle.protect(t("有未保存的个人资料"))
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = "" }
    window.addEventListener("beforeunload", prevent)
    return () => { release(); window.removeEventListener("beforeunload", prevent) }
  }, [dirty, t])

  async function save() {
    if (!profile) return
    const nameChanged = name !== (profile.displayName ?? "")
    if ((nameChanged && ([...name.trim()].length < 1 || [...name.trim()].length > 80)) || [...bio].length > 1000) {
      setError("名称须为 1–80 个字符，简介最多 1000 个字符"); return
    }
    const patch: { displayName?: string; biography?: string | null } = {}
    if (nameChanged) patch.displayName = name.trim()
    if (bio !== (profile.biography ?? "")) patch.biography = bio || null
    const current = generation.current
    setBusy(true); setError(""); setNotice("")
    try {
      const value = await profileApi.patch(patch, profile.revision)
      if (generation.current !== current) return
      loadValues(value); setChallenge(""); setToken(""); setNotice("资料已保存")
    } catch (reason) { if (generation.current === current) failure(reason, true) }
    finally { if (generation.current === current) setBusy(false) }
  }

  async function mutate(operation: () => Promise<SelfProfile>, message: string, options: { keepChallenge?: boolean; clearAvatar?: boolean } = {}) {
    const current = generation.current
    setBusy(true); setError(""); setNotice("")
    try {
      const value = await operation()
      if (generation.current !== current) return
      setProfile(value); setNotice(message)
      if (!options.keepChallenge) { setChallenge(""); setToken("") }
      if (options.clearAvatar) { setAvatar(null); setPreview("") }
    } catch (reason) { if (generation.current === current) failure(reason, true) }
    finally { if (generation.current === current) setBusy(false) }
  }
  function chooseAvatar(file?: File) {
    setAvatar(null); setPreview(""); setError("")
    if (!file) return
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 2 * 1024 * 1024) {
      setError("头像须为 JPEG、PNG 或 WebP，且不超过 2 MiB"); return
    }
    setAvatar(file)
    const current = generation.current
    const reader = new FileReader()
    reader.onload = () => { if (generation.current === current && typeof reader.result === "string") setPreview(reader.result) }
    reader.readAsDataURL(file)
  }
  async function sendContact() {
    if (!profile) return
    const current = generation.current
    setChallenge(""); setToken("")
    await mutate(async () => {
      const result = await profileApi.createChallenge(address, profile.revision)
      if (generation.current === current) setChallenge(result.challengeId)
      return result.profile
    }, "验证邮件已发送，请输入邮件中的验证令牌", { keepChallenge: true })
  }

  return <div className="space-y-6">
    <PageHeader title={t("编辑个人资料")} description={t("这些资料仅本人可见。登录邮箱和安全设置独立管理。")}/>
    <Button asChild variant="ghost"><Link to="/">{t("返回账户总览")}</Link></Button>
    {error && <p role="alert" className="text-destructive">{t(error)}</p>}
    {notice && <p role="status">{t(notice)}</p>}
    {busy && !profile && <p role="status">{t("正在读取个人资料")}</p>}
    {(error || conflict) && <Button disabled={busy} onClick={() => void reload()} variant="outline">{t("重新读取资料")}</Button>}
    {profile && <><Card>
      <CardHeader><CardTitle>{t("基本资料")}</CardTitle></CardHeader>
      <CardContent><form className="space-y-4" onSubmit={event => { event.preventDefault(); void save() }}>
        <div className="space-y-2"><label htmlFor="profile-name">{t("名称")}</label><Input id="profile-name" value={name} disabled={busy} onChange={event => setName(event.target.value)} autoComplete="nickname"/></div>
        <div className="space-y-2"><label htmlFor="profile-bio">{t("简介")}</label><Textarea id="profile-bio" className="min-h-28" value={bio} disabled={busy} onChange={event => setBio(event.target.value)}/></div>
        <div className="flex flex-wrap gap-2"><Button type="submit" disabled={writeBlocked || !textDirty}>{t("保存基本资料")}</Button>
          <Button type="button" variant="outline" disabled={busy || !textDirty} onClick={() => loadValues(profile)}>{t("取消编辑")}</Button></div>
      </form></CardContent>
    </Card>
    <Card><CardHeader><CardTitle>{t("头像")}</CardTitle></CardHeader><CardContent className="space-y-4">
      {(preview || profile.hasAvatar) && <img key={profile.revision + preview} src={preview || "/me/api/profile/avatar"} alt={t("个人头像")} className="size-24 rounded-full object-cover"/>}
      <p>{t("JPEG、PNG 或 WebP，最多 2 MiB。图片将由服务器规范化处理。")}</p>
      <label htmlFor="profile-avatar">{t("选择头像")}</label><Input id="profile-avatar" type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={event => chooseAvatar(event.target.files?.[0])}/>
      <div className="flex flex-wrap gap-2"><Button disabled={writeBlocked || !avatar} onClick={() => avatar && void mutate(() => profileApi.uploadAvatar(avatar, profile.revision), "头像已保存", { clearAvatar: true })}>{t("上传头像")}</Button>
      <Button variant="outline" disabled={writeBlocked || !profile.hasAvatar} onClick={() => { if (window.confirm(t("确定删除头像？"))) void mutate(() => profileApi.deleteAvatar(profile.revision), "头像已删除", { clearAvatar: true }) }}>{t("删除头像")}</Button></div>
    </CardContent></Card>
    <Card><CardHeader><CardTitle>{t("联系邮箱")}</CardTitle></CardHeader><CardContent className="space-y-4">
      <p>{t("联系邮箱独立于登录邮箱和找回渠道，不会改变登录凭据。")}</p>
      <p>{profile.contactEmail.address} <span>{t(profile.contactEmail.state === "verified" ? "已验证" : profile.contactEmail.state === "pending" ? "等待验证" : "未设置联系邮箱")}</span></p>
      <form className="space-y-3" onSubmit={event => { event.preventDefault(); void sendContact() }}>
        <label htmlFor="profile-contact">{t("联系邮箱")}</label><Input id="profile-contact" type="email" autoComplete="email" value={address} disabled={busy} required onChange={event => setAddress(event.target.value)}/>
        <Button disabled={writeBlocked}>{t("发送验证邮件")}</Button>
      </form>
      {challenge && <form className="space-y-3" onSubmit={event => { event.preventDefault(); void mutate(() => profileApi.confirmContact(challenge, token), "联系邮箱已验证") }}>
        <label htmlFor="profile-contact-token">{t("邮件中的验证令牌")}</label><Input id="profile-contact-token" autoComplete="off" autoCapitalize="none" spellCheck={false} value={token} disabled={busy} required onChange={event => setToken(event.target.value)}/>
        <Button disabled={writeBlocked || !token}>{t("确认联系邮箱")}</Button>
      </form>}
      {profile.contactEmail.state === "pending" && !challenge && <p>{t("请重新发送验证邮件以开始本次确认。")}</p>}
      <Button variant="outline" disabled={writeBlocked || profile.contactEmail.state === "none"} onClick={() => { if (window.confirm(t("确定删除联系邮箱及未完成的验证？"))) void mutate(() => profileApi.deleteContact(profile.revision), "联系邮箱已删除") }}>{t("删除联系邮箱")}</Button>
    </CardContent></Card></>}
  </div>
}
