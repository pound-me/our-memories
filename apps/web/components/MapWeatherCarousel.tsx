"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { cities } from "@/data/cities";
import {
  appSettingsUpdatedEvent,
  normalizeMemberProfiles,
  readAppSettings,
} from "@/data/appSettings";
import { fetchCitiesWeather, weatherFallbackTemp, type WeatherInfo } from "@/lib/weather";
import { WeatherPixelIcon } from "@/components/WeatherPixelIcon";

const cityById = new Map(cities.map((city) => [city.id, city]));
function readCarouselCityIds() {
  const profiles = normalizeMemberProfiles(readAppSettings().memberProfiles);
  const ids = Object.values(profiles)
    .map((profile) => profile.cityId)
    .filter((cityId): cityId is string => Boolean(cityId && cityById.has(cityId)));

  return Array.from(new Set(ids)).slice(0, 4);
}

export default function MapWeatherCarousel() {
  const [cityIds, setCityIds] = useState<string[]>([]);
  const [weatherByCityId, setWeatherByCityId] = useState<Record<string, WeatherInfo>>({});
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const sync = () => setCityIds(readCarouselCityIds());
    sync();
    window.addEventListener(appSettingsUpdatedEvent, sync);
    window.addEventListener("storage", sync);

    return () => {
      window.removeEventListener(appSettingsUpdatedEvent, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  useEffect(() => {
    if (cityIds.length === 0) return;
    let cancelled = false;

    async function loadWeather() {
      const points = cityIds
        .map((cityId) => cityById.get(cityId))
        .filter((city): city is NonNullable<typeof city> => Boolean(city));
      const weather = await fetchCitiesWeather(points.map((city) => ({ city })));
      if (!cancelled) setWeatherByCityId(weather);
    }

    void loadWeather();
    const refreshTimer = window.setInterval(loadWeather, 30 * 60_000);

    return () => {
      cancelled = true;
      window.clearInterval(refreshTimer);
    };
  }, [cityIds]);

  useEffect(() => {
    if (cityIds.length <= 1) return;
    const timer = window.setInterval(() => {
      setActiveIndex((current) => (current + 1) % cityIds.length);
    }, 5_000);

    return () => window.clearInterval(timer);
  }, [cityIds.length]);

  const safeActiveIndex = cityIds.length > 0 ? activeIndex % cityIds.length : 0;
  const activeCityId = cityIds[safeActiveIndex] ?? cityIds[0] ?? "";
  const city = cityById.get(activeCityId);
  const weather = weatherByCityId[activeCityId];
  const label = useMemo(() => {
    if (!city) return "天气读取中";
    return `${city.name} ${weather?.label ?? "多云"} ${weather?.temp ?? weatherFallbackTemp}°`;
  }, [city, weather?.label, weather?.temp]);

  return (
    <div className="relative h-8 min-w-0 overflow-hidden text-sm font-semibold text-ink/68 sm:h-9 sm:text-base">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div
          key={`${activeCityId}-${weather?.kind ?? "partly"}-${weather?.temp ?? weatherFallbackTemp}`}
          className="absolute inset-0 flex min-w-0 items-center gap-2"
          initial={{ y: "100%", opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: "-100%", opacity: 0 }}
          transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
        >
          <WeatherPixelIcon kind={weather?.kind ?? "partly"} className="h-6 w-6 shrink-0 sm:h-7 sm:w-7" />
          <span className="min-w-0 truncate">{label}</span>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
