import type { DefenseControlState } from '../world/defenses';

export interface WorldPin {
  label: string;
  detail: string;
  pos: [number, number, number];
}

export interface ChapterDef {
  id: number;
  nav: string;
  eyebrow: string;
  title: string;
  body: string;
  metric?: { value: string; caption: string };
  side: 'left' | 'right';
  camPos: [number, number, number];
  camTarget: [number, number, number];
  storm: number;
  seaLevel: number;
  riverLevel: number;
  streetFlood: number;
  defenses: DefenseControlState;
  pins: WorldPin[];
}

export const CHAPTERS: ChapterDef[] = [
  {
    id: 0,
    nav: '01 Moon',
    eyebrow: '01 · Space & Tides',
    title: 'It All Begins with the Moon’s Gravity',
    body: 'Lunar gravity pulls Earth’s oceans into a giant tidal bulge every day. During a new or full moon (spring tide), sea levels rise even higher—and when a coastal cyclone strikes at the same time, an ordinary wave becomes a catastrophic storm surge.',
    metric: { value: '+1.8 m', caption: 'peak spring tide ahead of the storm' },
    side: 'left',
    camPos: [-48, 534, 48],
    camTarget: [10, 504, -38],
    storm: 0.0,
    seaLevel: 0.4,
    riverLevel: 0.4,
    streetFlood: -2.0,
    defenses: { stormGates: false, floodWalls: false, spongeCity: false, collector: false, cutawayOpen: false },
    pins: [
      { label: 'The Moon', detail: '384,400 km · primary driver of ocean tides', pos: [24, 520, -45] },
      { label: 'Tidal Bulge', detail: 'raises coastal water levels before landfall', pos: [-6, 480, -28] },
    ],
  },
  {
    id: 1,
    nav: '02 City',
    eyebrow: '02 · River Estuary Metropolis',
    title: 'A Metropolis Sitting Just +1.8 m Above Sea Level',
    body: 'The city grew across a flat coastal delta around a busy shipping estuary and seaport. In calm weather, stone embankments hold back the tide—yet downtown towers, transit tunnels, and avenues sit almost flush with sea level.',
    metric: { value: '1.2M', caption: 'residents inside the storm-surge risk zone' },
    side: 'right',
    camPos: [-108, 64, 122],
    camTarget: [4, 12, -14],
    storm: 0.08,
    seaLevel: 0.45,
    riverLevel: 0.45,
    streetFlood: -2.0,
    defenses: { stormGates: false, floodWalls: false, spongeCity: false, collector: false, cutawayOpen: false },
    pins: [
      { label: 'Financial District', detail: 'street elevation +1.8 to +2.4 m', pos: [-56, 46, -22] },
      { label: 'River Estuary', detail: 'open shipping channel with no sea gate', pos: [6, 9, 28] },
      { label: 'Cable-Stayed Bridge', detail: 'connects the west and east riverbanks', pos: [14, 24, 0] },
    ],
  },
  {
    id: 2,
    nav: '03 Threat',
    eyebrow: '03 · Unprotected City',
    title: 'Storm Surge Overwhelms the Avenues',
    body: 'Hurricane-force winds drive a +4.8 m wall of ocean water inland. With no barrier in place, the surge races up the river, spills over the +2.3 m stone seawalls, and turns city avenues into rushing canals within minutes.',
    metric: { value: '+4.8 m', caption: 'storm surge overtopping coastal embankments' },
    side: 'left',
    camPos: [-22, 24, 58],
    camTarget: [-44, 4, -18],
    storm: 0.92,
    seaLevel: 4.8,
    riverLevel: 4.5,
    streetFlood: 3.4,
    defenses: { stormGates: false, floodWalls: false, spongeCity: false, collector: false, cutawayOpen: false },
    pins: [
      { label: 'Storm Sea +4.8 m', detail: 'wind-driven surge advancing from the south', pos: [4, 5.5, 42] },
      { label: 'Seawall Overtopping', detail: 'water breaches the +2.3 m stone parapet', pos: [-16, 4.8, 12] },
      { label: 'Flooded Districts', detail: 'standing surge water across streets & lobbies', pos: [-48, 4.5, -18] },
    ],
  },
  {
    id: 3,
    nav: '04 Barrier',
    eyebrow: '04 · Line I — Pivoting Storm Surge Barrier',
    title: 'Steel Sector Gates Seal the River Mouth',
    body: 'When a storm warning is issued, two floating steel arch gates—modeled after the Dutch Maeslant Barrier—swing out from shore dry docks. They lock across the shipping channel, absorbing the +4.8 m sea surge while keeping the city river calm.',
    metric: { value: '4.2 m', caption: 'water-level differential held across the gates' },
    side: 'right',
    camPos: [-56, 26, 98],
    camTarget: [6, 3, 46],
    storm: 0.88,
    seaLevel: 4.8,
    riverLevel: 0.6,
    streetFlood: -2.0,
    defenses: { stormGates: true, floodWalls: false, spongeCity: false, collector: false, cutawayOpen: false },
    pins: [
      { label: 'Storm Sea: +4.8 m', detail: 'ocean swells crash against the outer steel arcs', pos: [-16, 5.5, 68] },
      { label: 'Pivoting Barrier', detail: 'twin sector trusses seal the river mouth', pos: [4, 6.5, 48] },
      { label: 'City River: +0.6 m', detail: 'safe inner basin; avenues stay dry', pos: [6, 3, 18] },
    ],
  },
  {
    id: 4,
    nav: '05 Walls & Sponge',
    eyebrow: '05 · Line II — Hydraulic Floodwalls & Sponge City',
    title: 'Deployable Levees & Retention Water Parks',
    body: 'Even when stormwaters swell the river to +3.6 m, hydraulic glass-and-steel floodwalls lock upward to +5.3 m along both embankments. Right beside the riverfront, the terraced Sponge-City Water Plaza channels intense street rainfall through storm spillways, holding up to 50,000 m³.',
    metric: { value: '50,000 m³', caption: 'stormwater retained inside terraced sponge parks' },
    side: 'left',
    camPos: [-14, 20, -73],
    camTarget: [16, 1.5, -93],
    storm: 0.72,
    seaLevel: 4.8,
    riverLevel: 3.6,
    streetFlood: -2.0,
    defenses: { stormGates: true, floodWalls: true, spongeCity: true, collector: false, cutawayOpen: false },
    pins: [
      { label: 'River Surge: +3.6 m', detail: 'swollen runoff held safely inside the channel', pos: [-2, 4.0, -78] },
      { label: 'Hydraulic Floodwalls (+5.3 m)', detail: 'deployable glass & steel levees seal both banks', pos: [6, 6.2, -79] },
      { label: 'Sponge Water Plaza', detail: 'terraced park absorbs 50,000 m³ of street rain', pos: [28.5, 4.6, -92] },
    ],
  },
  {
    id: 5,
    nav: '06 Water Temple',
    eyebrow: '06 · Line III — Deep Underground Collector (G-Cans)',
    title: 'A 30 m Deep “Water Temple” Beneath the Park',
    body: 'When extreme rainfall overwhelms surface drains, vertical drop shafts divert floodwater 30 meters underground into a cathedral-like concrete surge tank inspired by Tokyo’s G-Cans. High-head turbines pump up to 200 m³/s straight back out to sea.',
    metric: { value: '200 m³/s', caption: 'deep-tunnel pumping discharge capacity' },
    side: 'left',
    camPos: [42, 46, 12],
    camTarget: [80, -14, -31],
    storm: 0.65,
    seaLevel: 4.8,
    riverLevel: 0.7,
    streetFlood: -2.0,
    defenses: { stormGates: true, floodWalls: true, spongeCity: true, collector: true, cutawayOpen: true },
    pins: [
      { label: 'Intake Shaft (−30 m)', detail: 'vertical drop diverting street stormwater', pos: [66, -12, -39] },
      { label: '“Water Temple” Cavern', detail: '15 massive pillars dissipate flow energy', pos: [80, -21, -24] },
      { label: 'Pump Station', detail: 'turbines discharge excess water out to sea', pos: [95, -15, -31] },
    ],
  },
  {
    id: 6,
    nav: '07 Explore',
    eyebrow: '07 · Free 3D Sandbox',
    title: 'Explore the City & Flood Defense Systems',
    body: 'Orbit and zoom freely around the coastal metropolis. Toggle any engineering defense layer on or off to compare an unprotected storm surge with a resilient four-tier protected city.',
    side: 'left',
    camPos: [-112, 68, 122],
    camTarget: [6, 8, -10],
    storm: 0.85,
    seaLevel: 4.8,
    riverLevel: 0.6,
    streetFlood: -2.0,
    defenses: { stormGates: true, floodWalls: true, spongeCity: true, collector: true, cutawayOpen: false },
    pins: [],
  },
];
