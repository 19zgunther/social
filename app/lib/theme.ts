export const THEME_STORAGE_KEY = "zocial_theme_info";

export type ThemeColors = {
  bg: string;
  surface: string;
  border: string;
  foreground: string;
  muted: string;
  accent: string;
  onAccent: string;
  rainbow1: string;
  rainbow2: string;
  rainbow3: string;
  rainbow4: string;
  rainbow5: string;
};

const DEFAULT_THEME_COLORS: ThemeColors = {
  bg: "#050608",
  surface: "#1b1f27",
  border: "#2d3440",
  foreground: "#f3f6fc",
  muted: "#a29da9",
  accent: "#764fad",
  onAccent: "#050608",
  rainbow1: "#70aad6",
  rainbow2: "#897aaf",
  rainbow3: "#c084e8",
  rainbow4: "#bb8a9c",
  rainbow5: "#55b777",
};

export const THEME_PRESETS = {
  default: {
    label: "Default",
    colors: DEFAULT_THEME_COLORS,
  },
  ocean: {
    label: "Ocean",
    colors: {
      bg: "#041018",
      surface: "#0f2433",
      border: "#1e3a4d",
      foreground: "#e8f4fc",
      muted: "#8aa8bc",
      accent: "#38bdf8",
      onAccent: "#041018",
      rainbow1: "#38bdf8",
      rainbow2: "#60a5fa",
      rainbow3: "#818cf8",
      rainbow4: "#22d3ee",
      rainbow5: "#34d399",
    },
  },
  forest: {
    label: "Forest",
    colors: {
      bg: "#171710",
      surface: "#14261a",
      border: "#244030",
      foreground: "#eaf6ee",
      muted: "#8fad97",
      accent: "#4ade80",
      onAccent: "#07140c",
      rainbow1: "#86efac",
      rainbow2: "#4ade80",
      rainbow3: "#a3e635",
      rainbow4: "#6e5426",
      rainbow5: "#2dd4bf",
    },
  },
  sunset: {
    label: "Sunset",
    colors: {
      bg: "#14080c",
      surface: "#2a141c",
      border: "#4a2434",
      foreground: "#fceef2",
      muted: "#c49aa8",
      accent: "#fb7185",
      onAccent: "#14080c",
      rainbow1: "#fb7185",
      rainbow2: "#f97316",
      rainbow3: "#fbbf24",
      rainbow4: "#e879f9",
      rainbow5: "#f472b6",
    },
  },
  light: {
    label: "Light",
    colors: {
      bg: "#f4f6fa",
      surface: "#ffffff",
      border: "#d5dbe7",
      foreground: "#141820",
      muted: "#6b7280",
      accent: "#6d28d9",
      onAccent: "#ffffff",
      rainbow1: "#0ea5e9",
      rainbow2: "#7c3aed",
      rainbow3: "#db2777",
      rainbow4: "#ea580c",
      rainbow5: "#16a34a",
    },
  },
} as const satisfies Record<string, { label: string; colors: ThemeColors }>;

export type NamedPresetId = keyof typeof THEME_PRESETS;
export type ThemePresetId = NamedPresetId | "custom";

export type ThemeInfo = {
  presetId: ThemePresetId;
  colors: ThemeColors;
};

export const THEME_COLOR_KEYS = [
  "bg",
  "surface",
  "border",
  "foreground",
  "muted",
  "accent",
  "onAccent",
  "rainbow1",
  "rainbow2",
  "rainbow3",
  "rainbow4",
  "rainbow5",
] as const satisfies ReadonlyArray<keyof ThemeColors>;

export const THEME_COLOR_LABELS: Record<keyof ThemeColors, string> = {
  bg: "Background",
  surface: "Surface",
  border: "Border",
  foreground: "Foreground",
  muted: "Muted",
  accent: "Accent",
  onAccent: "On accent",
  rainbow1: "Rainbow 1",
  rainbow2: "Rainbow 2",
  rainbow3: "Rainbow 3",
  rainbow4: "Rainbow 4",
  rainbow5: "Rainbow 5",
};

const CSS_VAR_BY_COLOR_KEY: Record<keyof ThemeColors, string> = {
  bg: "--bg",
  surface: "--surface",
  border: "--border",
  foreground: "--foreground",
  muted: "--muted",
  accent: "--accent",
  onAccent: "--on-accent",
  rainbow1: "--rainbow-1",
  rainbow2: "--rainbow-2",
  rainbow3: "--rainbow-3",
  rainbow4: "--rainbow-4",
  rainbow5: "--rainbow-5",
};

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

const NAMED_PRESET_IDS = Object.keys(THEME_PRESETS) as NamedPresetId[];

const PRESET_IDS: ReadonlyArray<ThemePresetId> = [...NAMED_PRESET_IDS, "custom"];

export const DEFAULT_THEME: ThemeInfo = {
  presetId: "default",
  colors: DEFAULT_THEME_COLORS,
};

export const NAMED_THEME_PRESETS = NAMED_PRESET_IDS.map((id) => ({
  id,
  label: THEME_PRESETS[id].label,
  colors: THEME_PRESETS[id].colors,
}));

export const isHexColor = (value: unknown): value is string =>
  typeof value === "string" && HEX_COLOR_RE.test(value);

const isPresetId = (value: unknown): value is ThemePresetId =>
  typeof value === "string" && (PRESET_IDS as ReadonlyArray<string>).includes(value);

const parseColors = (value: unknown): ThemeColors | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const colors = {} as ThemeColors;

  for (const key of THEME_COLOR_KEYS) {
    const color = record[key];
    if (!isHexColor(color)) {
      return null;
    }
    colors[key] = color.toLowerCase();
  }

  return colors;
};

export const parseThemeInfo = (value: unknown): ThemeInfo | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (!isPresetId(record.presetId)) {
    return null;
  }

  const colors = parseColors(record.colors);
  if (!colors) {
    return null;
  }

  return {
    presetId: record.presetId,
    colors,
  };
};

export const themeFromPreset = (presetId: NamedPresetId): ThemeInfo => ({
  presetId,
  colors: { ...THEME_PRESETS[presetId].colors },
});

export const themeWithColorOverride = (
  current: ThemeInfo,
  key: keyof ThemeColors,
  hex: string,
): ThemeInfo => ({
  presetId: "custom",
  colors: {
    ...current.colors,
    [key]: hex.toLowerCase(),
  },
});

const relativeLuminance = (hex: string): number => {
  const channels = [1, 3, 5].map((offset) => {
    const channel = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
};

const colorSchemeForTheme = (colors: ThemeColors): "dark" | "light" =>
  relativeLuminance(colors.bg) > 0.45 ? "light" : "dark";

const updateThemeColorMeta = (bg: string) => {
  if (typeof document === "undefined") {
    return;
  }

  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.setAttribute("name", "theme-color");
    document.head.appendChild(meta);
  }
  meta.setAttribute("content", bg);
};

export const applyThemeToDocument = (theme: ThemeInfo) => {
  if (typeof document === "undefined") {
    return;
  }

  const root = document.documentElement;
  for (const key of THEME_COLOR_KEYS) {
    root.style.setProperty(CSS_VAR_BY_COLOR_KEY[key], theme.colors[key]);
  }

  const scheme = colorSchemeForTheme(theme.colors);
  root.style.colorScheme = scheme;
  document.body.style.colorScheme = scheme;
  updateThemeColorMeta(theme.colors.bg);
};

export const readStoredTheme = (): ThemeInfo | null => {
  if (typeof window === "undefined" || !window.localStorage) {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    return parseThemeInfo(JSON.parse(raw));
  } catch {
    return null;
  }
};

const writeStoredTheme = (theme: ThemeInfo) => {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }

  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(theme));
  } catch {
    // Ignore quota / private-mode failures.
  }
};

export const persistAndApplyTheme = (theme: ThemeInfo) => {
  writeStoredTheme(theme);
  applyThemeToDocument(theme);
};

export const resetThemeToDefault = () => {
  if (typeof window !== "undefined" && window.localStorage) {
    try {
      window.localStorage.removeItem(THEME_STORAGE_KEY);
    } catch {
      // Ignore storage failures.
    }
  }
  applyThemeToDocument(DEFAULT_THEME);
};

/** Inline boot script: apply cached theme before first paint. */
export const THEME_BOOT_SCRIPT = `(function(){try{var k=${JSON.stringify(THEME_STORAGE_KEY)};var raw=localStorage.getItem(k);if(!raw)return;var t=JSON.parse(raw);if(!t||!t.colors)return;var map={bg:"--bg",surface:"--surface",border:"--border",foreground:"--foreground",muted:"--muted",accent:"--accent",onAccent:"--on-accent",rainbow1:"--rainbow-1",rainbow2:"--rainbow-2",rainbow3:"--rainbow-3",rainbow4:"--rainbow-4",rainbow5:"--rainbow-5"};var hex=/^#[0-9a-fA-F]{6}$/;var r=document.documentElement;var c=t.colors;for(var key in map){var v=c[key];if(typeof v==="string"&&hex.test(v))r.style.setProperty(map[key],v.toLowerCase());}var bg=c.bg;if(typeof bg==="string"&&hex.test(bg)){var ch=[1,3,5].map(function(o){var x=parseInt(bg.slice(o,o+2),16)/255;return x<=0.03928?x/12.92:Math.pow((x+0.055)/1.055,2.4);});var lum=0.2126*ch[0]+0.7152*ch[1]+0.0722*ch[2];r.style.colorScheme=lum>0.45?"light":"dark";var m=document.querySelector('meta[name="theme-color"]');if(!m){m=document.createElement("meta");m.setAttribute("name","theme-color");document.head.appendChild(m);}m.setAttribute("content",bg.toLowerCase());}}catch(e){}})();`;
