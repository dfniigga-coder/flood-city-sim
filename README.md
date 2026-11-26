# AQUASHIELD — Interactive 3D Coastal Flood Defense Simulation

An interactive WebGL / Three.js scrollytelling experience built for a Project-Based Learning (PBL) presentation demonstrating how coastal cities defend against lunar spring tides, storm surges, and extreme urban rainfall.

## Interactive Chapters

1. **01 · Space & Tides** — 2K crater-displaced procedural Moon and photorealistic 4K NASA Earth (`earth_day_4096`, `earth_night_4096`, `earth_normal_2048`, ocean specular glint, animated 3D cloud deck, Rayleigh atmosphere) illustrating tidal bulge generation.
2. **02 · River Estuary Metropolis** — Coastal delta city built with instanced CC0 `.glb` skyscrapers, architectural curtain-wall towers, traffic, shipping port, cable-stayed bridges, and estuary channel sitting at +1.8 m.
3. **03 · Unprotected City** — A +4.8 m wind-driven storm surge overtopping coastal embankments and flooding city avenues.
4. **04 · Pivoting Storm Surge Barrier** — Twin floating radial steel gates (modeled after the Dutch Maeslant Barrier) sealing the river mouth with breaking wave spray plumes.
5. **05 · Hydraulic Floodwalls & Sponge City** — +5.3 m glass-and-steel deployable river/coastal floodwalls alongside a terraced waterfront Sponge-City Water Plaza capturing street rainfall via stormwater cascades.
6. **06 · Deep Underground Collector (G-Cans)** — 30 m geological cutaway revealing Tokyo G-Cans–inspired surge shafts, a 15-pillar concrete "Water Temple" chamber, and deep-tunnel drainage turbines.
7. **07 · Free 3D Sandbox** — Orbit, zoom, and toggle any defense layer or storm scenario independently.

## Tech Stack

- **TypeScript + Vite**
- **Three.js** (Instanced `.glb` city & traffic, 4× MSAA HalfFloat HDR `EffectComposer`, `UnrealBloomPass`, PCF shadows)
- **Custom GLSL Shaders** (Gerstner ocean waves + 4-octave surface FBM ripples, Moon GPU bake, NASA 4K Earth shader)
- **Web Audio API** (`SoundEngine` procedural rain, thunder, wind, and ocean ambience)

## Getting Started

```bash
npm install
npm run dev
```

Build for production:

```bash
npm run typecheck && npm run build
```

## Asset Credits

- **3D City, Vehicles, Watercraft & Nature Models**: [Kenney](https://kenney.nl/) (CC0 1.0 Universal)
- **Planetary Earth Imagery**: NASA / [Three.js planet textures](https://github.com/mrdoob/three.js/tree/dev/examples/textures/planets)
