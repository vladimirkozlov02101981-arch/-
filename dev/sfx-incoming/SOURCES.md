# Footstep SFX — sources and licenses

All files: Ogg Vorbis (q6), mono, 44.1 kHz. Processing: resample/downmix, and for files whose
peak was above −1 dBFS a small gain reduction to −1 dBFS (no normalization, no pitch/time
changes). Each file is already a single step (0.17–0.38 s), so no slicing was needed.

Original sites (opengameart.org, kenney.nl, freesound.org) were not reachable from the build
environment (egress policy 403), so files were taken from public game repositories on GitHub
that vendor them with per-file license records. Source pages of the original recordings are
listed where the repository names them.

Repositories (pinned commits):
- **minetest_game** — https://github.com/luanti-org/minetest_game @ `c42e4d0c0ff9d27ff7b9b308c3cfc14098dd3a0f`,
  license records in `mods/default/README.md` / `mods/default/license.txt`.
- **Pixture** — https://github.com/kaadmy/pixture @ `e0865f77c15a8dc23293ee0c1c0b36f54905a150`,
  `README.md`: "Sounds in the default mod are all by Kenney (CC0)"; `mods/default/README.txt`: "Sound license: CC0".

| File | Original file in repo | Author | License | Original recording |
|---|---|---|---|---|
| grass/01.ogg | pixture `mods/default/sounds/default_soft_footstep.1.ogg` | Kenney (kenney.nl) | CC0 1.0 | Kenney audio packs, https://kenney.nl/assets |
| grass/02.ogg | pixture `default_soft_footstep.2.ogg` | Kenney | CC0 1.0 | same |
| grass/03.ogg | pixture `default_soft_footstep.3.ogg` | Kenney | CC0 1.0 | same |
| dirt/01.ogg | pixture `default_crunch_footstep.1.ogg` | Kenney | CC0 1.0 | same |
| dirt/02.ogg | pixture `default_crunch_footstep.2.ogg` | Kenney | CC0 1.0 | same |
| dirt/03.ogg | pixture `default_crunch_footstep.3.ogg` | Kenney | CC0 1.0 | same |
| dirt/04.ogg | minetest_game `mods/default/sounds/default_sand_footstep.1.ogg` | worthahep88 | CC0 1.0 | https://freesound.org/people/worthahep88/sounds/319224/ |
| dirt/05.ogg | minetest_game `default_sand_footstep.2.ogg` | worthahep88 | CC0 1.0 | same |
| dirt/06.ogg | minetest_game `default_sand_footstep.3.ogg` | worthahep88 | CC0 1.0 | same |
| stone/01.ogg | minetest_game `default_hard_footstep.1.ogg` | Erdie | CC BY 3.0 | https://freesound.org/people/Erdie/sounds/41579/ |
| stone/02.ogg | minetest_game `default_hard_footstep.2.ogg` | Erdie | CC BY 3.0 | same |
| stone/03.ogg | minetest_game `default_hard_footstep.3.ogg` | Erdie | CC BY 3.0 | same |
| wood/01.ogg | pixture `default_hard_footstep.1.ogg` | Kenney | CC0 1.0 | Kenney audio packs, https://kenney.nl/assets |
| wood/02.ogg | pixture `default_hard_footstep.2.ogg` | Kenney | CC0 1.0 | same |
| wood/03.ogg | pixture `default_hard_footstep.3.ogg` | Kenney | CC0 1.0 | same |
| snow/01.ogg | minetest_game `default_snow_footstep.1.ogg` | Ryding | CC0 1.0 | https://freesound.org/people/Ryding/sounds/94337/ |
| snow/02.ogg | minetest_game `default_snow_footstep.2.ogg` | Ryding | CC0 1.0 | same |
| snow/03.ogg | minetest_game `default_snow_footstep.3.ogg` | Ryding | CC0 1.0 | same |
| snow/04.ogg | minetest_game `default_snow_footstep.4.ogg` | Ryding | CC0 1.0 | same |
| snow/05.ogg | minetest_game `default_snow_footstep.5.ogg` | Ryding | CC0 1.0 | same |
| metal/01.ogg | minetest_game `default_metal_footstep.1.ogg` | mypantsfelldown | CC0 1.0 | https://freesound.org/people/mypantsfelldown/sounds/398937/ |
| metal/02.ogg | minetest_game `default_metal_footstep.2.ogg` | mypantsfelldown | CC0 1.0 | same |
| metal/03.ogg | minetest_game `default_metal_footstep.3.ogg` | mypantsfelldown | CC0 1.0 | same |

## Notes / caveats (check by ear before use)

- **Attribution required** only for `stone/*` (CC BY 3.0): "Footsteps by Erdie
  (https://freesound.org/people/Erdie/sounds/41579/), CC BY 3.0, via minetest_game; re-encoded."
- **Kenney files**: Pixture does not record which Kenney pack/file each sound came from.
  Pixture's own mapping: `soft` → grass/leaves/sand, `crunch` → dirt/gravel, `hard` → stone *and* wood.
  The `hard` set was put under `wood` because it is a dull low thud (spectral centroid ≈ 300 Hz),
  unlike Erdie's sharp concrete steps (≈ 2–3 kHz). Treat `wood/` as tentative.
  All three Kenney sets are strongly low-passed (almost nothing above ~1 kHz).
- `dirt/04–06` are sand steps (worthahep88) — closest CC0 substitute for loose ground.
- Under 4 variants: grass (3), stone (3), wood (3), metal (3). No more CC0/CC-BY single steps
  for these surfaces were reachable; the other surface sets in minetest_game / MineClone2
  (grass, dirt, gravel, wood by Mito551) are **CC BY-SA 3.0** and were deliberately excluded,
  as were Veloren's footsteps (GPL-3.0 by default).
