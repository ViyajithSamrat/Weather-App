"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { Layers2 } from "lucide-react";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { OpenWeatherWeatherMapLayer } from "@/types/openweather";

// OpenFreeMap — free, no API key, no account required
// Docs: https://openfreemap.org
const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";

const DEFAULT_LAYER = "precipitation_new";

const WEATHER_MAP_LAYERS: {
  value: OpenWeatherWeatherMapLayer;
  label: string;
}[] = [
  { value: "precipitation_new", label: "Precipitation" },
  { value: "clouds_new", label: "Clouds" },
  { value: "pressure_new", label: "Pressure" },
  { value: "wind_new", label: "Wind Speed" },
  { value: "temp_new", label: "Temperature" },
];

function addWeatherLayer(
  map: maplibregl.Map,
  layer: OpenWeatherWeatherMapLayer,
) {
  if (map.getSource("openweather-tiles")) {
    map.removeLayer("openweather-layer");
    map.removeSource("openweather-tiles");
  }
  map.addSource("openweather-tiles", {
    type: "raster",
    tiles: [`/api/weather/${layer}/{z}/{x}/{y}`],
    tileSize: 256,
  });
  map.addLayer({
    id: "openweather-layer",
    type: "raster",
    source: "openweather-tiles",
    paint: {
      "raster-opacity": 0.8,
      "raster-saturation": 1,
      "raster-brightness-min": 0.15,
      "raster-brightness-max": 1,
      "raster-contrast": 1,
    },
  });
}

export default function Map({ lat, lon }: { lat: number; lon: number }) {
  const [layer, setLayer] = useState<OpenWeatherWeatherMapLayer>(DEFAULT_LAYER);

  const mapRef = useRef<maplibregl.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!mapContainerRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: MAP_STYLE,
      center: [lon, lat],
      zoom: 5,
      maxTileCacheSize: 100,
      refreshExpiredTiles: false,
    });

    mapRef.current = map;

    map.addControl(new maplibregl.NavigationControl(), "top-right");

    map.on("load", () => {
      addWeatherLayer(map, DEFAULT_LAYER);
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const center = map.getCenter();
    if (center.lng === lon && center.lat === lat) return;
    map.flyTo({ center: [lon, lat], zoom: 5 });
  }, [lat, lon]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getSource("openweather-tiles")) return;
    addWeatherLayer(map, layer);
  }, [layer]);

  return (
    <div className="relative size-full">
      <div
        ref={mapContainerRef}
        className="absolute inset-0 size-full rounded-xl"
      />

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              size={"icon"}
              aria-label="Change weather layer"
              className="text-primary outline-accent hover:bg-muted absolute top-2.5 right-12 size-[29px] rounded-sm bg-white shadow-[0_0_0_1px_#0000001a] dark:bg-white dark:text-black [&_svg:not([class*='size-'])]:size-4"
            >
              <Layers2 strokeWidth={3} />
            </Button>
          }
        />
        <DropdownMenuContent align="end" side="bottom" className="w-34">
          <DropdownMenuRadioGroup value={layer} onValueChange={setLayer}>
            {WEATHER_MAP_LAYERS.map((l) => (
              <DropdownMenuRadioItem key={l.value} value={l.value}>
                {l.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
