/** Un point d'ancrage : instant UTC (secondes) + prix. Indépendant de l'unité de temps affichée. */
export interface Anchor { time: number; price: number }

export type ToolId = 'trend' | 'ray' | 'hline' | 'vline' | 'channel' | 'fib' | 'fibext' | 'rect' | 'text' | 'arrow' | 'measure' | 'long' | 'short';

export interface Style { color: string; width: number; text?: string }

export interface Drawing { id: string; symbol: string; tool: ToolId; anchors: Anchor[]; style: Style }

export interface ToolDef {
  id: ToolId;
  label: string;
  /** Lettre du raccourci Alt+<touche>. */
  key: string;
  /** Nombre de clics nécessaires pour créer l'objet. */
  clicks: number;
  color: string;
  icon: string; // chemin SVG (viewBox 24)
}

export const TOOLS: ToolDef[] = [
  { id: 'trend', label: 'Ligne de tendance', key: 't', clicks: 2, color: '#2962ff', icon: 'M4 19 L20 5 M4 19 m-2 0 a2 2 0 1 0 4 0 a2 2 0 1 0 -4 0 M20 5 m-2 0 a2 2 0 1 0 4 0 a2 2 0 1 0 -4 0' },
  { id: 'ray', label: 'Rayon', key: 'r', clicks: 2, color: '#2962ff', icon: 'M4 19 L21 4 M4 19 m-2 0 a2 2 0 1 0 4 0 a2 2 0 1 0 -4 0 M17 4 l4 0 l0 4' },
  { id: 'hline', label: 'Ligne horizontale', key: 'h', clicks: 1, color: '#ff9800', icon: 'M3 12 L21 12' },
  { id: 'vline', label: 'Ligne verticale', key: 'v', clicks: 1, color: '#ff9800', icon: 'M12 3 L12 21' },
  { id: 'channel', label: 'Canal parallèle', key: 'c', clicks: 3, color: '#26a69a', icon: 'M3 16 L17 6 M7 20 L21 10' },
  { id: 'fib', label: 'Retracement de Fibonacci', key: 'f', clicks: 2, color: '#f7931a', icon: 'M3 5 L21 5 M3 10 L21 10 M3 15 L21 15 M3 20 L21 20' },
  { id: 'fibext', label: 'Extension de Fibonacci', key: 'e', clicks: 3, color: '#f7931a', icon: 'M3 19 L9 10 L14 14 M14 14 L21 4' },
  { id: 'rect', label: 'Rectangle', key: 'b', clicks: 2, color: '#9c27b0', icon: 'M4 6 H20 V18 H4 Z' },
  { id: 'text', label: 'Texte', key: 'x', clicks: 1, color: '#d1d4dc', icon: 'M5 6 H19 M12 6 V19 M9 19 H15' },
  { id: 'arrow', label: 'Flèche', key: 'a', clicks: 2, color: '#ef5350', icon: 'M4 20 L19 5 M19 5 H11 M19 5 V13' },
  { id: 'measure', label: 'Règle (prix, %, durée)', key: 'm', clicks: 2, color: '#4dd0e1', icon: 'M3 15 L15 3 L21 9 L9 21 Z M7 11 l3 3 M10 8 l2 2 M13 5 l1 1' },
  { id: 'long', label: 'Position longue', key: 'l', clicks: 2, color: '#26a69a', icon: 'M5 12 H19 M12 4 V12 M5 4 H19 M12 12 V20 M5 20 H19' },
  { id: 'short', label: 'Position courte', key: 's', clicks: 2, color: '#ef5350', icon: 'M5 12 H19 M12 20 V12 M5 20 H19 M12 12 V4 M5 4 H19' },
];

export const toolDef = (id: ToolId) => TOOLS.find((t) => t.id === id)!;

export const COLORS = ['#2962ff', '#26a69a', '#ef5350', '#ff9800', '#9c27b0', '#d1d4dc', '#4dd0e1', '#f7931a'];

export const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
export const FIB_EXT_LEVELS = [0, 0.618, 1, 1.618, 2.618, 3.618, 4.236];
