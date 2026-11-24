# Lightweight Nextbot Resource Pack — proposed schema v1

This is the **generator-side contract**, not a claim that any released MOD can read it yet.

## ZIP layout

```
pack.mcmeta
runes-nextbot-manifest.json
README.txt
assets/runesnextbot/
  sounds.json
  textures/nextbots/01.png
  sounds/nextbots/01.ogg
  nextbots/01.json
```

The user chooses the `pack_format` value; `34` is the default for Java Edition 1.21–1.21.1.

## Nextbot definition

```json
{
  "schemaVersion": 1,
  "id": 1,
  "name": "Nextbot 01",
  "texture": "runesnextbot:nextbots/01",
  "sound": "runesnextbot:nextbots/01",
  "effects": {
    "gaming": {
      "enabled": true,
      "mode": "diagonal",
      "direction": "tl-br",
      "opacity": 0.45,
      "speed": 1
    },
    "enchant": {
      "enabled": true,
      "strength": 35,
      "renderer": "vanilla_entity_glint",
      "speedMultiplier": 0.3333333333333333,
      "directions": 2,
      "maskTransparentPixels": true
    }
  }
}
```

Resource location `runesnextbot:nextbots/01` maps to `assets/runesnextbot/textures/nextbots/01.png`.
The sound event maps to the key `nextbots/01` in `assets/runesnextbot/sounds.json`; its file is `sounds/nextbots/01.ogg`.

- The lightweight exporter uses one **already cropped/chroma-keyed, untinted PNG** per Nextbot. It must never use a pre-rendered frame of an effect as the source texture.
- GIF and video input is intentionally reduced to **the first frame of the selected processed range** for lightweight mode; classic export retains animations.
- Previously saved animated assets lacking `basePng` must be opened and applied again, because recovering the untinted/cropped image is not lossless.
- Rendering settings are **MOD-specific**, not built-in Minecraft resource-pack JSON. They do nothing without a future client-side MOD renderer/decoder that reads the definitions, renders alpha-masked glint and animated gaming colors.
- The current `buildAssetArchive` export path is unchanged and produces a source-asset ZIP without `pack.mcmeta`.
- Unknown metadata fields should be ignored by a future MOD reader for forwards compatibility; invalid schema versions should be rejected.

No JAR is generated or modified by this feature.
