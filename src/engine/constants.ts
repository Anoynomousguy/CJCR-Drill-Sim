import type { PlanSettings, Uniform } from './types';

/** Manual of Drill and Ceremonial (A-DH-201-000/PT-000) Ch 3 §Pace length and cadences. */
export const PACE = 0.75; // quick and slow time
export const PACE_STEP_OUT = 0.85;
export const PACE_STEP_SHORT = 0.55;
export const PACE_DOUBLE = 1.0;
export const PACE_HALF = 0.35; // half pace, used for three paces or less
export const PACE_SIDE = 0.25;

export const CADENCE = { quick: 120, slow: 60, double: 180 } as const;

/** One beat of quick time = 0.5 s. The standard pause is two beats. */
export const BEAT = 0.5;
export const STANDARD_PAUSE = 1.0;

export const DEFAULT_SETTINGS: PlanSettings = {
  squareWidth: 40,
  squareDepth: 30,
  strength: 24,
  squads: 3,
  ranks: 3,
  intervalPaces: 1.5, // full arm dressing, Ch 1 Annex A
  rankSpacingPaces: 1.25,
  squadGapPaces: 7, // Ch 7 platoon in line
  openOrder: false,
  colours: 1,
  commander: true,
  supernumerary: true,
  uniform: 'sea',
  armed: true,
  cadence: 120,
  heightSeed: 1187,
  startPacesFromEdge: 6,
  headingDeg: 0,
};

export interface UniformPalette {
  label: string;
  tunic: string;
  tunicShade: string;
  trousers: string;
  shirt: string;
  accent: string;
  beret: string;
  belt: string;
  boots: string;
  brassard: string;
}

export const UNIFORMS: Record<Uniform, UniformPalette> = {
  army: {
    label: 'Army',
    tunic: '#4c5a3a',
    tunicShade: '#3f4a30',
    trousers: '#3a4330',
    shirt: '#c8c2ac',
    accent: '#8b8f6a',
    beret: '#3f4a33',
    belt: '#2f3229',
    boots: '#221f1c',
    brassard: '#6d7350',
  },
  sea: {
    label: 'Sea',
    tunic: '#20293b',
    tunicShade: '#18202f',
    trousers: '#1b2231',
    shirt: '#dfe4ea',
    accent: '#b8bdad',
    beret: '#1a2130',
    belt: '#12161f',
    boots: '#15161a',
    brassard: '#7d8798',
  },
  air: {
    label: 'Air',
    tunic: '#3a4a5c',
    tunicShade: '#2f3d4c',
    trousers: '#33404f',
    shirt: '#cfd6dd',
    accent: '#9aa7b4',
    beret: '#2c3947',
    belt: '#20272f',
    boots: '#171a1f',
    brassard: '#5c6c7c',
  },
};

export const ROLE_LABEL: Record<string, string> = {
  cadet: 'Cadet',
  marker: 'Right marker',
  commander: 'Platoon commander',
  wo: 'Platoon warrant officer',
  colourOfficer: 'Colour officer',
  colourEscort: 'Colour escort',
};
