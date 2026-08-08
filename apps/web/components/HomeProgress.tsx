"use client";

import { useEffect, useMemo, useState, type ReactNode, type SVGProps } from "react";
import Link from "next/link";
import Image from "next/image";
import { CalendarDays, Heart, Images, RefreshCw } from "lucide-react";
import { LocalPrivacyImage } from "@/components/LocalPrivacyImage";
import { cities } from "@/data/cities";
import {
  getLitCityIds,
  getLitProvinceIds,
} from "@/data/progress";
import { TOTAL_PROVINCES } from "@/data/provinces";
import { memoryTime } from "@/data/memories";
import {
  appSettingsUpdatedEvent,
  defaultCoupleLogo,
  normalizeAnniversaryDate,
  readAppSettings,
  syncAppSettings,
  type AppSettings,
} from "@/data/appSettings";
import TripGuidesCard from "@/components/TripGuidesCard";
import { WeatherPixelIcon } from "@/components/WeatherPixelIcon";
import { summaryToMemoryStore, useMemorySummary } from "@/lib/memorySummaryStore";
import { pullRefreshEvent } from "@/lib/refresh";
import { useDeferredReady } from "@/lib/useDeferredReady";
import { useIsMobile } from "@/lib/useIsMobile";
import { flowerSprite } from "@/lib/generatedAssets";
import {
  fetchCitiesWeather,
  weatherFallbackTemp,
  type WeatherInfo,
} from "@/lib/weather";

// Reads the user's local settings and stays in sync when they change them
// from the settings page (same tab via custom event, other tabs via storage).
function useAppSettings(): { settings: AppSettings; ready: boolean } {
  const [settings, setSettings] = useState<AppSettings>({});
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const sync = () => {
      setSettings(readAppSettings());
      setReady(true);
    };
    const syncRemote = () => {
      void syncAppSettings()
        .then((nextSettings) => {
          setSettings(nextSettings);
          setReady(true);
        })
        .catch(() => setReady(true));
    };
    sync();
    syncRemote();
    window.addEventListener(appSettingsUpdatedEvent, sync);
    window.addEventListener("storage", sync);
    window.addEventListener(pullRefreshEvent, syncRemote);

    return () => {
      window.removeEventListener(appSettingsUpdatedEvent, sync);
      window.removeEventListener("storage", sync);
      window.removeEventListener(pullRefreshEvent, syncRemote);
    };
  }, []);

  return { settings, ready };
}

const daysTogether = (date?: string) => {
  const normalizedDate = normalizeAnniversaryDate(date);
  if (!normalizedDate) return null;

  const [year, month, day] = normalizedDate.split(".").map(Number);
  const start = new Date(year, month - 1, day);
  const today = new Date();

  start.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);

  return Math.max(0, Math.floor((today.getTime() - start.getTime()) / 86_400_000));
};

const formatClock = (value: Date) =>
  new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(value);

const formatDate = (value: Date) =>
  new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
  }).format(value);

const formatWeekday = (value: Date) =>
  new Intl.DateTimeFormat("zh-CN", {
    weekday: "long",
  }).format(value);

function useTogetherDays() {
  const { settings, ready } = useAppSettings();
  const startDate = normalizeAnniversaryDate(settings.anniversaryDate);
  const label = settings.anniversaryLabel ?? (ready ? "尚未设置" : "正在读取");
  const days = daysTogether(startDate);

  return { days, label, startDate, ready };
}

function WeatherFrame(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 128 8" aria-hidden="true" {...props}>
      <rect x="0" y="3" width="128" height="2" fill="var(--color-dim)" opacity="0.45" />
      <rect x="14" y="2" width="14" height="4" fill="var(--color-sakura)" opacity="0.72" />
      <rect x="88" y="2" width="8" height="4" fill="var(--color-mist)" opacity="0.82" />
    </svg>
  );
}

function WeatherCard() {
  const [weather, setWeather] = useState<Record<string, WeatherInfo>>({});
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const { settings, ready: settingsReady } = useAppSettings();
  const isMobile = useIsMobile();
  const ready = useDeferredReady(1500);

  const locationCities = useMemo(
    () =>
      (settings.weatherCityIds ?? [])
        .map((cityId) => {
          const city = cities.find((item) => item.id === cityId);
          return city ? { cityId, fallbackTemp: weatherFallbackTemp, city } : null;
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item)),
    [settings.weatherCityIds],
  );

  useEffect(() => {
    if (!ready || !settingsReady || isMobile || locationCities.length === 0) return;
    let cancelled = false;

    async function loadWeather() {
      setIsLoading(true);
      const nextWeather = await fetchCitiesWeather(locationCities.map(({ city, fallbackTemp }) => ({ city, fallbackTemp })));

      if (!cancelled) {
        setWeather(nextWeather);
        setUpdatedAt(new Date());
        setIsLoading(false);
      }
    }

    loadWeather();
    const interval = window.setInterval(loadWeather, 30 * 60_000);
    window.addEventListener(pullRefreshEvent, loadWeather);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener(pullRefreshEvent, loadWeather);
    };
  }, [isMobile, locationCities, ready, settingsReady]);

  if (isMobile) return null;

  return (
    <div className="mb-4 rounded-[8px] border border-dim/70 bg-cream/66 p-3 text-ink shadow-[0_10px_24px_rgba(90,102,112,0.05)] backdrop-blur">
      <div className="mb-2 flex items-center justify-between gap-3 px-1">
        <div>
          <p className="text-xs font-semibold text-ink/58">沿途天气</p>
          <p className="text-[11px] text-ink/42">
            {updatedAt ? `${formatClock(updatedAt)} 更新` : "正在匹配"}
          </p>
        </div>
        <RefreshCw className={`h-4 w-4 text-sky ${isLoading ? "animate-spin" : ""}`} />
      </div>
      <WeatherFrame className="mb-2 h-2 w-full" />
      <div className="grid grid-cols-3 gap-2">
        {locationCities.length === 0 ? (
          <div className="col-span-3 rounded-[8px] border border-dim/56 bg-white/36 px-3 py-6 text-center text-xs font-semibold text-ink/45">
            {settingsReady ? "尚未设置天气地点" : "正在读取地点"}
          </div>
        ) : locationCities.map(({ city, fallbackTemp }) => {
          const item = weather[city.id] ?? {
            cityId: city.id,
            temp: fallbackTemp,
            kind: "partly" as const,
            label: "多云",
          };

          return (
            <div
              key={city.id}
              className="min-w-0 rounded-[8px] border border-dim/56 bg-white/36 px-2 py-2 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.55)]"
            >
              <p className="truncate text-[11px] font-semibold leading-none text-ink/70">{city.name}</p>
              <WeatherPixelIcon kind={item.kind} className="mx-auto mt-1 h-10 w-10" />
              <div className="mt-1 flex items-end justify-center gap-0.5 leading-none">
                <span className="text-lg font-semibold text-ink">{item.temp}</span>
                <span className="pb-0.5 text-xs font-semibold text-ink/52">°</span>
              </div>
              <p className="mt-1 truncate text-[11px] font-semibold text-sky">{item.label}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DateTimeCard() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    const tick = () => setNow(new Date());
    const firstTick = window.setTimeout(tick, 0);
    const interval = window.setInterval(tick, 30_000);

    return () => {
      window.clearTimeout(firstTick);
      window.clearInterval(interval);
    };
  }, []);

  return (
    <div className="mb-4 rounded-[8px] border border-dim/70 bg-cream/62 px-4 py-3 text-ink shadow-[0_10px_24px_rgba(90,102,112,0.05)]">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold leading-none text-ink/54">今天</p>
          <p className="mt-1 text-2xl font-semibold leading-none text-sky">
            {now ? formatClock(now) : "--:--"}
          </p>
        </div>
        <div className="text-right">
          <CalendarDays className="ml-auto h-4 w-4 text-bloom" />
          <p className="mt-2 text-xs font-semibold text-ink/64">
            {now ? `${formatDate(now)} ${formatWeekday(now)}` : "加载中"}
          </p>
        </div>
      </div>
    </div>
  );
}

function TogetherDaysCard() {
  const { days, label, startDate, ready } = useTogetherDays();

  return (
    <div className="mt-3 rounded-[8px] border border-dim/70 bg-cream/62 px-4 py-3 text-ink shadow-[0_10px_24px_rgba(90,102,112,0.05)]">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-ink/58">纪念日</p>
          <p className="mt-1 text-sm font-semibold text-ink">{label}</p>
        </div>
        <div className="flex items-end gap-1.5">
          <span className="text-2xl font-semibold leading-none text-bloom">{days ?? "—"}</span>
          <span className="pb-0.5 text-sm font-semibold text-ink/56">天</span>
        </div>
      </div>
      <p className="mt-1 truncate text-xs text-ink/45">
        {startDate ? `从 ${startDate} 开始` : ready ? "请在设置中填写纪念日" : "正在同步纪念日"}
      </p>
    </div>
  );
}

export function TogetherDaysBadge({ compact = false }: Readonly<{ compact?: boolean }> = {}) {
  const { days, label, ready } = useTogetherDays();

  return (
    <div
      className={`flex w-fit max-w-full items-center gap-1.5 rounded-full border border-dim/80 bg-cream/78 text-ink/78 shadow-[0_8px_22px_rgba(90,102,112,0.08)] backdrop-blur ${
        compact ? "px-2.5 py-1 text-[11px]" : "px-3 py-1.5 text-xs"
      }`}
    >
      <CalendarDays className={`${compact ? "h-3.5 w-3.5" : "h-4 w-4"} shrink-0 text-sky`} />
      <span className="min-w-0 truncate">
        {ready && days !== null ? (
          <>
            {compact ? "在一起" : label}
            <strong className="mx-1 font-semibold text-bloom">{days}</strong>
            天
          </>
        ) : ready ? "纪念日尚未设置" : "纪念日读取中"}
      </span>
    </div>
  );
}

function AlbumProgressCard() {
  const progress = useProgress();
  const provincePercent = Math.round((progress.provinceCount / TOTAL_PROVINCES) * 100);
  const cityPercent = Math.round((progress.cityCount / cities.length) * 100);

  return (
    <Link
      className="group mt-3 block rounded-[8px] border border-dim/70 bg-cream/62 px-4 py-3 text-ink shadow-[0_10px_24px_rgba(90,102,112,0.05)] transition hover:-translate-y-0.5 hover:border-sakura hover:bg-white/72"
      href="/memories"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[8px] border border-sakura/80 bg-sakura/42 text-bloom transition group-hover:bg-sakura/68">
            <Images className="h-4 w-4" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">回忆相册</span>
            <span className="mt-0.5 block truncate text-xs text-ink/48">看全部照片</span>
          </span>
        </span>
        <span className="text-lg leading-none text-ink/34 transition group-hover:translate-x-0.5 group-hover:text-bloom">
          →
        </span>
      </div>

      <div className="mt-4 border-t border-dim/54 pt-4">
        <div className="mb-3 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-ink">我们的进度</p>
            <p className="mt-0.5 text-xs text-ink/52">我们的回忆</p>
          </div>
          <Heart className="h-5 w-5 fill-sakura text-bloom" />
        </div>

        <div className="space-y-3">
          <div>
            <div className="flex items-end justify-between gap-3">
              <div className="text-sm text-ink/68">已点亮省份</div>
              <div className="text-sm font-semibold text-ink">
                <span className="text-xl text-bloom">{progress.provinceCount}</span>
                <span className="ml-1 text-ink/46">/ {TOTAL_PROVINCES}</span>
              </div>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-dim/48">
              <div
                className="h-full rounded-full bg-bloom shadow-[0_0_12px_rgba(232,184,194,0.45)]"
                style={{ width: `${provincePercent}%` }}
              />
            </div>
          </div>

          <div>
            <div className="flex items-end justify-between gap-3">
              <div className="text-sm text-ink/68">已留下回忆城市</div>
              <div className="text-sm font-semibold text-ink">
                <span className="text-xl text-sky">{progress.cityCount}</span>
                <span className="ml-1 text-ink/46">/ {cities.length}</span>
              </div>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-dim/48">
              <div
                className="h-full rounded-full bg-sky shadow-[0_0_12px_rgba(168,200,220,0.45)]"
                style={{ width: `${cityPercent}%` }}
              />
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}

function CoupleLogo() {
  const [activeHead, setActiveHead] = useState<"left" | "right" | null>(null);
  const { settings } = useAppSettings();
  const logoSrc = settings.coupleLogo ?? defaultCoupleLogo;

  const popHead = (side: "left" | "right") => {
    setActiveHead(side);
    window.setTimeout(() => setActiveHead(null), 260);
  };

  return (
    <div className="mt-auto flex justify-center">
      <div className="relative aspect-[1106/849] w-52">
        <LocalPrivacyImage
          src={logoSrc}
          alt="我们的拼图头像 logo"
          fill
          sizes="208px"
          className={`object-contain transition-transform duration-300 ease-out ${
            activeHead === "left"
              ? "scale-[1.08] origin-[33%_47%]"
              : activeHead === "right"
                ? "scale-[1.08] origin-[69%_45%]"
                : "scale-100"
          }`}
        />
        <button
          className="absolute left-[15%] top-[23%] h-[42%] w-[31%] rounded-full outline-none transition hover:scale-[1.04] focus-visible:ring-2 focus-visible:ring-sky/70 active:scale-[1.08]"
          type="button"
          aria-label="放大左边头像"
          onClick={() => popHead("left")}
        />
        <button
          className="absolute right-[11%] top-[21%] h-[45%] w-[34%] rounded-full outline-none transition hover:scale-[1.04] focus-visible:ring-2 focus-visible:ring-bloom/70 active:scale-[1.08]"
          type="button"
          aria-label="放大右边头像"
          onClick={() => popHead("right")}
        />
      </div>
    </div>
  );
}

function useProgress() {
  const { data } = useMemorySummary();

  return useMemo(() => {
    const localMemories = summaryToMemoryStore(data?.summary ?? {});
    const litCityIds = getLitCityIds(localMemories);
    const litProvinceIds = getLitProvinceIds(litCityIds);

    return {
      cityCount: litCityIds.size,
      provinceCount: litProvinceIds.size,
    };
  }, [data?.summary]);
}

function useMapRitualStats() {
  const { days } = useTogetherDays();
  const { data } = useMemorySummary();

  return useMemo(() => {
    const summaryItems = Object.values(data?.summary ?? {});
    const localMemories = summaryToMemoryStore(data?.summary ?? {});
    const litCityIds = getLitCityIds(localMemories);
    const litProvinceIds = getLitProvinceIds(litCityIds);
    const latestMemory = summaryItems
      .flatMap((item) => (item.latest ? [item.latest] : []))
      .sort((a, b) => memoryTime(b) - memoryTime(a))[0];

    return {
      days,
      cityCount: litCityIds.size,
      provinceCount: litProvinceIds.size,
      memoryCount: summaryItems.reduce((total, item) => total + item.count, 0),
      latestCity: latestMemory?.city ?? "等待点亮",
      latestDate: latestMemory?.date ?? "第一站",
    };
  }, [data?.summary, days]);
}

export function MobileRitualStats() {
  const stats = useMapRitualStats();
  const badges = [
    { label: "在一起", value: stats.days ?? "—", unit: "天", accent: "text-bloom" },
    { label: "省份", value: stats.provinceCount, unit: "枚", accent: "text-sky" },
    { label: "城市", value: stats.cityCount, unit: "座", accent: "text-ink" },
    { label: "回忆", value: stats.memoryCount, unit: "条", accent: "text-bloom" },
  ];

  return (
    <section className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+9rem)] z-30 lg:hidden">
      <div className="space-y-2">
        <div className="grid grid-cols-4 gap-2">
          {badges.map((badge, index) => (
            <div
              key={badge.label}
              className="relative min-w-0 border-2 border-ink/18 bg-cream/88 px-1.5 pb-2 pt-1.5 text-center shadow-[3px_3px_0_rgba(90,102,112,0.16)] backdrop-blur"
            >
              <span className="absolute -right-1 -top-1 h-2 w-2 border border-ink/15 bg-white/72" />
              <PixelFlower className="mx-auto" variant={index} />
              <p className="mt-1 truncate text-[10px] font-semibold leading-none text-ink/48">{badge.label}</p>
              <p className={`mt-1 truncate text-lg font-semibold leading-none ${badge.accent}`}>
                {badge.value}
                <span className="ml-0.5 text-[10px] font-semibold text-ink/42">{badge.unit}</span>
              </p>
            </div>
          ))}
        </div>

        <div className="flex min-h-8 items-center justify-between gap-2 border-2 border-dim/70 bg-cream/86 px-3 text-[11px] font-semibold text-ink/58 shadow-[3px_3px_0_rgba(90,102,112,0.12)] backdrop-blur">
          <span className="shrink-0 text-bloom">最近一站</span>
          <span className="min-w-0 truncate text-right text-ink/70">
            {stats.latestCity} · {stats.latestDate}
          </span>
        </div>
      </div>
    </section>
  );
}

function PixelFlower({
  className,
  variant,
}: Readonly<{
  className?: string;
  variant: number;
}>) {
  const flower = flowerSprite(variant);

  return (
    <Image
      src={flower.src}
      alt=""
      width={64}
      height={64}
      className={`pixelated h-8 w-8 ${className ?? ""}`}
      aria-hidden="true"
      onError={(event) => {
        if (!flower.fallbackSrc || event.currentTarget.src.endsWith(flower.fallbackSrc)) return;
        event.currentTarget.src = flower.fallbackSrc;
      }}
    />
  );
}

export function ProgressBadge() {
  const progress = useProgress();

  return (
    <div className="ml-5 hidden items-center gap-2 rounded-[8px] border border-dim/90 bg-cream/70 px-4 py-2.5 text-sm text-ink/76 shadow-[0_8px_24px_rgba(90,102,112,0.08)] backdrop-blur sm:flex">
      <Heart className="h-4 w-4 fill-sakura text-bloom" />
      <span>已点亮</span>
      <strong className="font-semibold text-bloom">{progress.provinceCount}</strong>
      <span>/ {TOTAL_PROVINCES} 省份</span>
    </div>
  );
}

export function LegendProgress({ compact = false }: Readonly<{ compact?: boolean }> = {}) {
  const progress = useProgress();

  return (
    <div
      className={`flex w-fit items-center border border-dim/80 bg-cream/70 text-sm text-ink/80 shadow-[0_10px_28px_rgba(90,102,112,0.08)] backdrop-blur ${
        compact ? "gap-1.5 rounded-full px-2.5 py-1.5 text-xs" : "gap-3 rounded-[8px] px-5 py-3"
      }`}
    >
      <Heart className={`${compact ? "h-3.5 w-3.5" : "h-4 w-4"} fill-sakura text-bloom`} />
      {compact ? (
        <span className="whitespace-nowrap">
          <strong className="font-semibold text-ink">{progress.provinceCount}</strong> / {TOTAL_PROVINCES}
        </span>
      ) : (
        <span>
          <strong className="font-semibold text-ink">{progress.provinceCount}</strong> /{" "}
          {TOTAL_PROVINCES} provinces explored
        </span>
      )}
    </div>
  );
}

export function StatsPanel({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <aside className="hidden h-full w-[310px] shrink-0 flex-col overflow-y-auto border-l border-dashed border-dim px-7 py-7 lg:flex">
      <DateTimeCard />
      <WeatherCard />
      <TripGuidesCard />
      {children}
      <TogetherDaysCard />
      <AlbumProgressCard />
      <CoupleLogo />
    </aside>
  );
}

export function ProvinceProgressBadge({
  provinceId,
  total,
}: Readonly<{
  provinceId: string;
  total: number;
}>) {
  const { data } = useMemorySummary();

  const count = useMemo(() => {
    const localMemories = summaryToMemoryStore(data?.summary ?? {});
    const litCityIds = getLitCityIds(localMemories);

    return cities.filter((city) => city.provinceId === provinceId && litCityIds.has(city.id))
      .length;
  }, [data?.summary, provinceId]);

  return (
    <div className="hidden items-center gap-2 rounded-[8px] border border-dim/90 bg-cream/70 px-4 py-2.5 text-sm text-ink/76 shadow-[0_8px_24px_rgba(90,102,112,0.08)] backdrop-blur sm:flex">
      <Heart className="h-4 w-4 fill-sakura text-bloom" />
      <strong className="font-semibold text-bloom">{count}</strong>
      <span>/ {total} cities</span>
    </div>
  );
}
