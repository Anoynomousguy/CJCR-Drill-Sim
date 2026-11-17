// Core domain types for the CJCR parade planner.

export type Vec2 = { x: number; z: number };

export type Posture = 'attention' | 'standAtEase' | 'standEasy' | 'salute';
export type WeaponState =
  | 'none'
  | 'order'
  | 'slope'
  | 'present'
  | 'port'
  | 'inspection'
  | 'trail'
  | 'grounded'
  | 'reversed'
  | 'sling';
export type ColourState = 'none' | 'order' | 'carry' | 'slope' | 'dip' | 'letFly';
export type Gait = 'halt' | 'markTime' | 'quick' | 'slow' | 'double';
export type Eyes = 'front' | 'right' | 'left';
export type HeadDress = 'worn' | 'removed';
export type Spacing = 'close' | 'open';
export type Uniform = 'army' | 'sea' | 'air';
export type StepMode = 'normal' | 'out' | 'short';
export type Role = 'cadet' | 'marker' | 'commander' | 'wo' | 'colourOfficer' | 'colourEscort';
export type Discipline = 'foot' | 'rifle' | 'colour' | 'ceremonial';

export interface RosterEntry {
  id: string;
  height: number;
}

export interface PlanSettings {
  squareWidth: number;
  squareDepth: number;
  strength: number;
  squads: number;
  ranks: 2 | 3;
  intervalPaces: number;
  rankSpacingPaces: number;
  squadGapPaces: number;
  openOrder: boolean;
  colours: 0 | 1 | 2;
  commander: boolean;
  supernumerary: boolean;
  uniform: Uniform;
  armed: boolean;
  cadence: number;
  heightSeed: number;
  startPacesFromEdge: number;
  headingDeg: number;
}

export interface MovementInstance {
  id: string;
  type: string;
  params: Record<string, number | string>;
}

export interface Plan {
  version: number;
  name: string;
  settings: PlanSettings;
  roster: RosterEntry[];
  programme: MovementInstance[];
}

export interface Soldier {
  id: string;
  index: number;
  name: string;
  height: number;
  squad: number;
  rank: number;
  file: number;
  role: Role;
  rifle: boolean;
  colour: boolean;
  lx: number;
  lz: number;
}

export interface SoldierState extends Soldier {
  x: number;
  z: number;
  heading: number;
}

export interface Snapshot {
  posture: Posture;
  weapon: WeaponState;
  colour: ColourState;
  gait: Gait;
  eyes: Eyes;
  headdress: HeadDress;
  spacing: Spacing;
  step?: StepMode;
}

export interface Formation {
  soldiers: Soldier[];
  frontage: number;
  depth: number;
  centre: Vec2;
}

export interface Frame {
  x: number;
  z: number;
  heading: number;
}
