"use client";

import type { OWMGeocodingResult } from "@/types/openweather";

export default function SuggestionItem({
  result,
  onSelect,
}: {
  result: OWMGeocodingResult;
  onSelect: (result: OWMGeocodingResult) => void;
}) {
  return (
    <li>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onSelect(result)}
        className="hover:bg-accent w-full truncate rounded-md p-2 text-left text-sm"
      >
        <span>{result.name}</span>
        <span className="text-muted-foreground text-xs">
          {", "}
          {result.state ?? result.country}
        </span>
      </button>
    </li>
  );
}
