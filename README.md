# Rack

A modular synth in the browser. Every module is a [Faust](https://faust.grame.fr) program. The page compiles it with `@grame/faustwasm` into an AudioWorklet, and a cable is a Web Audio connection between two worklets.

The site is static files. There is no bundler and no backend. The interface is in German.

## What it does

- 32 modules: oscillators, filter, envelopes, sequencers, drums, effects, a quantizer, and a small evolving world as a signal source.
- Patch by dragging from jack to jack, or tap one jack and then the other. Drop a cable on a knob to modulate it.
- A rack that is open in a browser picks up new and changed modules within seconds, without a reload.
- Web MIDI: play the keyboard and pad modules, bind hardware knobs to rack knobs, send notes to a synth.
- The patch is saved in the browser and exports to JSON.

## Run it locally

Tested with Node.js 22.

```sh
npm install --include=dev
npm run dev
```

Open `http://localhost:5173`. `npm install` copies the Faust compiler into `vendor/`.

## Add a module

A module is two files in `modules/` and one entry in `modules/index.json`.

`modules/fold.dsp` is the sound. The inputs and outputs of `process` are the jacks:

```faust
import("stdfaust.lib");

amount = hslider("[0]Amount", 2, 1, 10, 0.01) : si.smoo;

process = *(amount) : sin;
```

`modules/fold.json` names the module and its jacks, in the order of `process`:

```json
{
	"name": "Fold",
	"description": "Folds a wave back on itself.",
	"color": "#9bc53d",
	"inputs": [{ "name": "In", "kind": "audio" }],
	"outputs": [{ "name": "Out", "kind": "audio" }]
}
```

1. Write both files.
2. Run `npm run modules -- fold`. It compiles the module without a browser and prints its jacks, its knobs, or the Faust error.
3. Add `"fold"` to `modules/index.json`.

The rack builds the knobs from the Faust UI elements. Pitch follows 1 V per octave with 0 at C4, a gate is 0 or 1, and every cable carries an audio-rate signal. [MODULES.md](MODULES.md) is the full reference for the module and patch formats. It is written in German.

## Run the tests

```sh
npm run modules           # compiles every module, without a browser
npm run build
node scripts/probe.mjs    # renders test patches offline and checks the numbers
npm run check             # drives the built site in headless Chromium
```

`probe` and `check` need Chromium. They look for it at `/usr/bin/chromium`. Set `CHROMIUM` to another path if yours is elsewhere.

## Host it yourself

```sh
npm run build
```

`dist/` then holds the whole site, about 7 MB, most of it the Faust compiler. Any web server for static files can serve it.

- **HTTPS is required.** Browsers allow AudioWorklet, Web MIDI, and the audio input only on HTTPS or on `localhost`.
- **COOP and COEP headers are not needed.** The page does not use `SharedArrayBuffer`. You can leave cross-origin isolation off.
- **Send `Cache-Control: no-cache`.** The browser then asks the server on each load, and a new build shows up at once.
- **Live modules.** To let an open rack pick up modules without a build, serve `modules/` and `patches/` from the checkout and everything else from `dist/`. [deploy/compose.example.yaml](deploy/compose.example.yaml) does that with Caddy in a container.

Changes to `src/`, `index.html`, or `style.css` need `npm run build` and a reload of the page.

## Layout

| Path | Job |
| --- | --- |
| `modules/` | The modules. |
| `patches/` | Example patches and their list. |
| `src/faust.js` | Loads and compiles modules, and notices changes. |
| `src/rack.js` | The audio graph and the patch, without DOM. |
| `src/ui.js` | Modules, knobs, and cables in the DOM. |
| `src/displays.js` | The live display in each module and the light in each jack. |
| `src/controls.js` | Maps a knob's travel to its value, also for MIDI and modulation. |
| `src/keyboard.js`, `src/pads.js` | Keys and pads: screen, computer keyboard, MIDI. |
| `src/midi.js`, `src/midiout.js` | Web MIDI: read inputs, send notes. |
| `src/life.js`, `src/life-world.js` | The world of the Leben module. |
| `scripts/` | `vendor`, `build`, `serve`, `check`, `modules`, `probe`. |

## License

MIT, see [LICENSE](LICENSE). The Faust compiler and libraries that the page loads keep their own licenses. [NOTICE](NOTICE) lists them.
