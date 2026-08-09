"use client";

import { useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { List, X } from "lucide-react";
import type { City } from "@/data/cities";
import { BottomSheet } from "@/components/ui/BottomSheet";

const subscribeToClientReady = () => () => {};
const clientReadySnapshot = () => true;
const serverReadySnapshot = () => false;

function useClientReady() {
  return useSyncExternalStore(subscribeToClientReady, clientReadySnapshot, serverReadySnapshot);
}

type CityListPanelProps = {
  provinceName: string;
  cityCount: number;
  cities: City[];
  litCityIds: Set<string>;
  selectedCityId: string | null;
  onSelectCity: (cityId: string, lit: boolean) => void;
};

export function CityListPanel({
  provinceName,
  cityCount,
  cities,
  litCityIds,
  selectedCityId,
  onSelectCity,
}: Readonly<CityListPanelProps>) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const clientReady = useClientReady();

  const cityRows = (closeAfterSelect = false) => cities.map((city) => {
    const lit = litCityIds.has(city.id);
    const selected = city.id === selectedCityId;

    return (
      <button
        key={city.id}
        className={`flex w-full items-center justify-between gap-3 rounded-[7px] px-3 py-2.5 text-left text-sm transition ${
          selected
            ? "bg-sakura text-bloom shadow-[0_8px_18px_rgba(232,184,194,0.16)]"
            : "text-ink/78 hover:bg-mist/34 active:bg-mist/48"
        }`}
        type="button"
        onClick={() => {
          if (closeAfterSelect) setMobileOpen(false);
          onSelectCity(city.id, lit);
        }}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span
            className={`h-2.5 w-2.5 shrink-0 rounded-full border-2 border-cream ${
              lit ? "bg-bloom shadow-[0_0_10px_rgba(232,184,194,0.55)]" : "bg-dim"
            }`}
          />
          <span className="truncate font-semibold">{city.name}</span>
        </span>
        <span className={`shrink-0 text-[11px] ${lit ? "text-bloom/80" : "text-ink/40"}`}>
          {lit ? "已去过" : "未去过"}
        </span>
      </button>
    );
  });

  return (
    <>
      <aside
        className="absolute right-0 top-3 z-40 hidden w-[230px] rounded-[8px] border border-dim/85 bg-cream/90 p-3 shadow-[0_16px_34px_rgba(90,102,112,0.10)] backdrop-blur lg:block"
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        onPointerMove={(event) => event.stopPropagation()}
        onWheel={(event) => event.stopPropagation()}
        aria-label={`${provinceName}城市列表`}
      >
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-ink">城市</h2>
          <span className="text-xs font-medium text-ink/54">{cityCount}</span>
        </div>
        <div className="max-h-[430px] space-y-1 overflow-y-auto pr-1">
          {cityRows()}
        </div>
      </aside>

      {clientReady && createPortal(
        !mobileOpen ? (
          <button
            className="fixed right-4 top-[calc(env(safe-area-inset-top)+0.85rem)] z-[75] flex min-h-12 items-center gap-2 rounded-[8px] border border-ink/24 bg-cream/92 px-3.5 text-sm font-semibold text-ink shadow-[0_8px_24px_rgba(90,102,112,0.10)] backdrop-blur transition active:scale-[0.98] lg:hidden"
            type="button"
            onPointerDown={(event) => {
              event.stopPropagation();
              setMobileOpen(true);
            }}
            onClick={(event) => {
              event.stopPropagation();
              setMobileOpen(true);
            }}
            aria-label={`打开${provinceName}城市列表，共${cityCount}个城市`}
          >
            <List className="h-5 w-5 text-sky" />
            <span>城市</span>
            <span className="rounded-full bg-mist/52 px-2 py-0.5 text-xs text-ink/58">{cityCount}</span>
          </button>
        ) : null,
        document.body,
      )}

      <BottomSheet
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        snapPoints={[0.58, 0.9]}
        initialSnap={0}
        header={
          <div className="flex items-center justify-between gap-3 border-b border-dim/70 pb-3 pt-1">
            <div>
              <div className="flex items-baseline gap-2">
                <h2 className="text-lg font-semibold text-ink">{provinceName}城市</h2>
                <span className="text-sm font-medium text-ink/48">{cityCount}</span>
              </div>
              <p className="mt-1 text-xs text-ink/54">点击城市即可定位并打开详情</p>
            </div>
            <button
              className="grid h-9 w-9 shrink-0 place-items-center rounded-[7px] text-ink/48 transition hover:bg-dim/30 hover:text-ink"
              type="button"
              onClick={() => setMobileOpen(false)}
              aria-label="关闭城市列表"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        }
        contentClassName="pt-2"
      >
        <div className="space-y-1 pb-4">{cityRows(true)}</div>
      </BottomSheet>
    </>
  );
}
