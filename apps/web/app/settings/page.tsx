"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import Link from "next/link";
import {
  CloudSun,
  Download,
  ImageIcon,
  MapPin,
  RefreshCw,
  Save,
  Sparkles,
  Upload,
  UserRound,
} from "lucide-react";
import { MemoryPageShell } from "@/components/MemoryNav";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useToast } from "@/components/ui/toast";
import {
  appSettingsStorageKey,
  appSettingsUpdatedEvent,
  normalizeAppSettings,
  normalizeMemberProfiles,
  readAppSettings,
  writeAppSettings,
  type AppSettings,
  type PartnerGender,
  type PartnerProfile,
} from "@/data/appSettings";
import { cities } from "@/data/cities";
import { provinces } from "@/data/provinces";
import { ApiError, apiJson } from "@/lib/apiClient";
import { authSessionUpdatedEvent, readSession, sessionKey, type StoredSession } from "@/lib/authStore";

type BackupPayload = {
  app: "our-memories";
  version: 1;
  exportedAt: string;
  localStorage: Record<string, string>;
};

const genderOptions = [
  { value: "female", label: "女生" },
  { value: "male", label: "男生" },
  { value: "neutral", label: "不限定" },
] satisfies Array<{ value: PartnerGender; label: string }>;

const backupKeyAllowed = (key: string) =>
  key.startsWith("mapofus:") &&
  key !== sessionKey &&
  key !== "mapofus:jpush-registration-id" &&
  !key.startsWith("mapofus:swr-cache:");

function sessionDisplayName(session: StoredSession | null) {
  return session?.user?.displayName || session?.user?.username || "我";
}

function sessionMemberKey(session: StoredSession | null) {
  return session?.user?.id || session?.user?.username || "local-user";
}

function settingsWithProfile(
  settings: AppSettings,
  memberKey: string,
  profile: PartnerProfile,
  displayName: string,
): AppSettings {
  return {
    ...settings,
    memberProfiles: {
      ...normalizeMemberProfiles(settings.memberProfiles),
      [memberKey]: {
        ...profile,
        name: displayName,
      },
    },
  };
}

function cityName(cityId?: string) {
  return cities.find((city) => city.id === cityId)?.name ?? "未选择";
}

function readBackupLocalStorage() {
  const data: Record<string, string> = {};

  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (!key || !backupKeyAllowed(key)) continue;

    const value = window.localStorage.getItem(key);
    if (value !== null) data[key] = value;
  }

  if (!data[appSettingsStorageKey]) {
    data[appSettingsStorageKey] = JSON.stringify(readAppSettings());
  }

  return data;
}

function readFileAsDataURL(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

type AvatarSpriteResponse = {
  profile?: PartnerProfile;
  url?: string;
};

function SelfSettingsCard({
  displayName,
  profile,
  onChange,
}: Readonly<{
  displayName: string;
  profile: PartnerProfile;
  onChange: (profile: PartnerProfile) => void;
}>) {
  const selectedCity = cities.find((city) => city.id === profile.cityId);
  const update = (patch: PartnerProfile) => onChange({ ...profile, ...patch });

  return (
    <Card padding="md" className="min-w-0">
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <UserRound className="h-4 w-4 text-bloom" />
            我的设置
          </span>
        }
        subtitle={selectedCity ? `${selectedCity.name} · ${selectedCity.landmark}` : "选择地图上的位置"}
      />

      <div className="mt-5 grid gap-4">
        <div className="grid gap-1.5 text-sm font-semibold text-ink/72">
          名字
          <div className="flex min-h-10 items-center rounded-[7px] border border-dim/80 bg-cream/58 px-3 text-sm text-ink">
            {displayName}
          </div>
        </div>

        <div className="grid gap-1.5">
          <span className="text-sm font-semibold text-ink/72">性别</span>
          <SegmentedControl
            value={profile.gender ?? "neutral"}
            options={genderOptions}
            onChange={(gender) => update({ gender })}
          />
        </div>

        <label className="grid gap-1.5 text-sm font-semibold text-ink/72">
          地点
          <select
            className="min-h-10 w-full rounded-[7px] border border-dim/80 bg-cream/76 px-3 text-sm text-ink outline-none transition focus:border-sky focus:bg-white"
            value={profile.cityId ?? ""}
            onChange={(event) => update({ cityId: event.target.value })}
          >
            {provinces.map((province) => {
              const provinceCities = cities.filter((city) => city.provinceId === province.id);
              if (provinceCities.length === 0) return null;

              return (
                <optgroup key={province.id} label={province.name}>
                  {provinceCities.map((city) => (
                    <option key={city.id} value={city.id}>
                      {city.name}
                    </option>
                  ))}
                </optgroup>
              );
            })}
          </select>
        </label>

      </div>
    </Card>
  );
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings>({});
  const [session, setSession] = useState<StoredSession | null>(null);
  const [profile, setProfile] = useState<PartnerProfile>({
    gender: "neutral",
  });
  const [saving, setSaving] = useState(false);
  const [avatarPrompt, setAvatarPrompt] = useState("");
  const [avatarReference, setAvatarReference] = useState("");
  const [avatarReferenceName, setAvatarReferenceName] = useState("");
  const [generatingAvatar, setGeneratingAvatar] = useState(false);
  const restoreInputRef = useRef<HTMLInputElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const nextSession = readSession();
      const nextSettings = readAppSettings();
      const memberKey = sessionMemberKey(nextSession);
      const profiles = normalizeMemberProfiles(nextSettings.memberProfiles);
      setSettings(nextSettings);
      setSession(nextSession);
      setProfile({
        gender: "neutral",
        ...profiles[memberKey],
        name: sessionDisplayName(nextSession),
      });
      setAvatarPrompt(profiles[memberKey]?.avatarPrompt ?? "");
    }, 0);

    const syncSession = () => setSession(readSession());
    window.addEventListener(authSessionUpdatedEvent, syncSession);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener(authSessionUpdatedEvent, syncSession);
    };
  }, []);

  const displayName = sessionDisplayName(session);
  const memberKey = sessionMemberKey(session);
  const selectedCity = cities.find((city) => city.id === profile.cityId);
  const selectedProvince = selectedCity ? provinces.find((province) => province.id === selectedCity.provinceId) : undefined;
  const summary = useMemo(() => {
    return `${displayName} 在 ${cityName(profile.cityId)}`;
  }, [displayName, profile.cityId]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const nextSettings = settingsWithProfile(settings, memberKey, profile, displayName);
      await writeAppSettings(nextSettings);
      setSettings(normalizeAppSettings(nextSettings));
      toast("设置已保存", "success");
    } catch {
      toast("设置已保存在本机，同步到后端失败", "warning");
    } finally {
      setSaving(false);
    }
  };

  const handleAvatarReference = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast("请选择图片文件", "error");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      toast("参考图不要超过 8MB", "error");
      return;
    }
    try {
      setAvatarReference(await readFileAsDataURL(file));
      setAvatarReferenceName(file.name);
    } catch {
      toast("读取图片失败", "error");
    }
  };

  const handleGenerateAvatar = async () => {
    if (!readSession()) {
      toast("请先登录后再生成地图角色", "warning");
      return;
    }

    setGeneratingAvatar(true);
    try {
      const response = await apiJson<AvatarSpriteResponse>("/settings/avatar-sprite", {
        method: "POST",
        body: JSON.stringify({
          prompt: avatarPrompt.trim(),
          referenceImage: avatarReference,
          gender: profile.gender ?? "neutral",
          displayName,
          cityId: selectedCity?.id ?? profile.cityId ?? "",
          cityName: selectedCity?.name ?? "",
          provinceName: selectedProvince?.name ?? "",
          landmark: selectedCity?.landmark ?? "",
        }),
      });
      const nextProfile: PartnerProfile = {
        ...profile,
        ...response.profile,
        avatarSprite: response.profile?.avatarSprite ?? response.url ?? profile.avatarSprite,
        avatarPrompt: avatarPrompt.trim() || response.profile?.avatarPrompt,
        name: displayName,
      };
      const nextSettings = settingsWithProfile(settings, memberKey, nextProfile, displayName);
      window.localStorage.setItem(appSettingsStorageKey, JSON.stringify(normalizeAppSettings(nextSettings)));
      window.dispatchEvent(new CustomEvent(appSettingsUpdatedEvent, { detail: normalizeAppSettings(nextSettings) }));
      setSettings(normalizeAppSettings(nextSettings));
      setProfile(nextProfile);
      setAvatarReference("");
      setAvatarReferenceName("");
      toast("地图角色已生成并上传", "success");
    } catch (error) {
      if (error instanceof ApiError && error.status === 503) {
        const message = error.message.toLowerCase().includes("not configured")
          ? "尚未配置生图 API。请先在管理端添加 OpenAI 兼容图片节点。"
          : "生图 API 暂时不可用，请检查地址、密钥、模型和网络连接。";
        toast(message, "error");
      } else {
        toast("地图角色生成失败，请稍后再试", "error");
      }
    } finally {
      setGeneratingAvatar(false);
    }
  };

  const handleBackup = () => {
    const payload: BackupPayload = {
      app: "our-memories",
      version: 1,
      exportedAt: new Date().toISOString(),
      localStorage: readBackupLocalStorage(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `our-memories-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    toast("备份已导出", "success");
  };

  const handleRestoreFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      const payload = parsed as Partial<BackupPayload> & { settings?: unknown };

      if (payload.localStorage && typeof payload.localStorage === "object" && !Array.isArray(payload.localStorage)) {
        Object.entries(payload.localStorage).forEach(([key, value]) => {
          if (backupKeyAllowed(key) && typeof value === "string") {
            window.localStorage.setItem(key, value);
          }
        });
      } else if (payload.settings) {
        window.localStorage.setItem(appSettingsStorageKey, JSON.stringify(normalizeAppSettings(payload.settings)));
      } else {
        window.localStorage.setItem(appSettingsStorageKey, JSON.stringify(normalizeAppSettings(parsed)));
      }

      const restoredSettings = readAppSettings();
      const restoredProfiles = normalizeMemberProfiles(restoredSettings.memberProfiles);
      setSettings(restoredSettings);
      setProfile({
        gender: "neutral",
        ...restoredProfiles[memberKey],
        name: displayName,
      });
      window.dispatchEvent(new CustomEvent(appSettingsUpdatedEvent, { detail: restoredSettings }));
      toast("恢复完成", "success");
    } catch {
      toast("恢复失败，文件格式不正确", "error");
    }
  };

  return (
    <MemoryPageShell active="settings">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
          <div>
            <h1 className="text-2xl font-semibold text-ink sm:text-3xl">设置</h1>
            <p className="mt-2 text-sm leading-6 text-ink/62">{summary}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={handleBackup}>
              <Download className="h-4 w-4" />
              备份
            </Button>
            <Button variant="secondary" onClick={() => restoreInputRef.current?.click()}>
              <Upload className="h-4 w-4" />
              恢复
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              保存
            </Button>
          </div>
        </div>

        <input
          ref={restoreInputRef}
          className="hidden"
          type="file"
          accept="application/json,.json"
          onChange={handleRestoreFile}
        />
        <input
          ref={avatarInputRef}
          className="hidden"
          type="file"
          accept="image/*"
          onChange={handleAvatarReference}
        />

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <SelfSettingsCard
            displayName={displayName}
            profile={profile}
            onChange={setProfile}
          />
          <Card padding="md">
            <CardHeader title="数据" subtitle="本机备份与恢复" />
            <div className="mt-5 grid gap-2">
              <Button variant="secondary" className="w-full justify-start" onClick={handleBackup}>
                <Download className="h-4 w-4" />
                备份
              </Button>
              <Button variant="secondary" className="w-full justify-start" onClick={() => restoreInputRef.current?.click()}>
                <Upload className="h-4 w-4" />
                恢复
              </Button>
            </div>
          </Card>
        </div>

        <Card padding="md">
          <CardHeader
            title={
              <span className="inline-flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-bloom" />
                生成地图角色
              </span>
            }
            subtitle="会自动带上当前性别和地点，生成带地方特色的吉卜力工作室画风人物，并上传到地图角色。"
          />
          <div className="mt-5 grid gap-4 lg:grid-cols-[140px_minmax(0,1fr)]">
            <div className="flex min-h-36 items-center justify-center rounded-[8px] border border-dim/80 bg-white/58">
              {profile.avatarSprite ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  className="max-h-32 max-w-32 object-contain"
                  src={profile.avatarSprite}
                  alt="当前地图角色"
                />
              ) : (
                <UserRound className="h-10 w-10 text-ink/32" />
              )}
            </div>
            <div className="grid gap-3">
              <label className="grid gap-1.5 text-sm font-semibold text-ink/72">
                提示词
                <textarea
                  className="min-h-24 w-full resize-y rounded-[7px] border border-dim/80 bg-cream/76 px-3 py-2 text-sm text-ink outline-none transition focus:border-sky focus:bg-white"
                  value={avatarPrompt}
                  maxLength={600}
                  placeholder="可选，例如：短发、暖色围巾、自然光下走过手绘旅行地图"
                  onChange={(event) => setAvatarPrompt(event.target.value)}
                />
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="secondary" onClick={() => avatarInputRef.current?.click()} disabled={generatingAvatar}>
                  <ImageIcon className="h-4 w-4" />
                  参考照片
                </Button>
                {avatarReferenceName && (
                  <span className="max-w-full truncate text-sm text-ink/58">{avatarReferenceName}</span>
                )}
                <Button onClick={handleGenerateAvatar} disabled={generatingAvatar}>
                  {generatingAvatar ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  {generatingAvatar ? "生成中" : "生成并上传"}
                </Button>
              </div>
            </div>
          </div>
        </Card>

        <Card padding="md">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-semibold text-ink">
                <MapPin className="h-4 w-4 text-bloom" />
                地图角色
              </div>
              <p className="mt-1 text-sm text-ink/60">
                保存后，你的地图角色会站到当前城市上方。
              </p>
            </div>
            <Link
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-[7px] border border-dim bg-cream/78 px-4 py-2 text-sm font-semibold text-ink transition hover:border-sky hover:text-sky"
              href="/map"
            >
              <CloudSun className="h-4 w-4" />
              回到地图
            </Link>
          </div>
        </Card>
      </div>
    </MemoryPageShell>
  );
}
