# Faust Rack

Ein modularer Synthesizer im Browser. Jedes Modul ist ein Faust-Programm. Der Browser kompiliert es beim Laden mit `@grame/faustwasm` zu einem AudioWorklet. Kabel sind Web-Audio-Verbindungen zwischen den Worklets.

Die Seite besteht aus statischen Dateien. Es gibt keinen Bundler und kein Backend.

## Starten

```sh
npm install --include=dev   # kopiert faustwasm nach vendor/
npm run dev                 # http://localhost:5173
```

`--include=dev` holt `playwright-core` für `npm run check`, auch wenn `NODE_ENV=production` gesetzt ist.

## Bauen und selbst hosten

```sh
npm run build     # schreibt dist/
npm run preview   # zeigt dist/ auf http://localhost:5173
```

`dist/` enthält alles und ist etwa 7 MB groß. Fast alles davon ist der Faust-Compiler. Jeder Webserver für statische Dateien genügt. Der Browser erlaubt AudioWorklets aber nur über HTTPS oder `localhost`.

COOP- und COEP-Header braucht die Seite nicht, weil sie keinen `SharedArrayBuffer` benutzt.

## Prüfen

```sh
npm run check     # oder: node scripts/check.mjs dist bild.png
```

`npm run modules` kompiliert alle Module ohne Browser. `node scripts/probe.mjs` rendert kleine Testpatches und prüft Zahlen wie Trefferzahl, Tonleiter und Stimmung.

`npm run check` lädt `dist/` in Chromium ohne Fenster. Es schlägt fehl, wenn ein Modul nicht kompiliert, ein Beispielpatch kein Signal am Ausgang liefert oder die Konsole einen Fehler zeigt. Es zieht auch ein Kabel und einen Regler mit der Maus, tauscht ein Modul im Betrieb und spielt über ein simuliertes MIDI-Gerät und ein simuliertes Mikrofon.

## Echte Geräte

Web MIDI und der Audio-Eingang brauchen Chrome oder Edge und HTTPS oder `localhost`. Der Knopf **MIDI** fragt einmal um Erlaubnis.

- Noten spielen jedes Keyboard-Modul. Noten auf Kanal 10 schlagen die Pads im Pads-Modul an, Note 36 ist Pad 1.
- Pitch-Bend und Modulationsrad kommen am Keyboard-Modul an.
- **Lernen** bindet einen Regler am Gerät an einen Regler im Rack. Der Patch speichert die Bindung.
- Das Modul MIDI Out schickt Pitch und Gate als Noten an alle MIDI-Ausgänge.
- Das Modul Audio In holt den Audio-Eingang des Rechners ins Rack.

## Aufbau

| Pfad | Aufgabe |
| --- | --- |
| `modules/` | Die Module. [MODULES.md](MODULES.md) beschreibt das Format. |
| `patches/` | Beispielpatches und ihre Liste. |
| `src/faust.js` | Lädt und kompiliert Module, erkennt Änderungen. |
| `src/rack.js` | Audio-Graph und Patch-Zustand, ohne DOM. |
| `src/ui.js` | Module, Regler und Kabel im DOM. |
| `src/controls.js` | Rechnet Reglerstellung in Werte um, auch für MIDI. |
| `src/displays.js` | Live-Anzeigen: Bild im Modul und Licht in jeder Buchse, eine Schleife für alle. |
| `src/keyboard.js`, `src/pads.js` | Klaviatur und Schlagflächen: Bildschirm, Computertasten, MIDI. |
| `src/midi.js`, `src/midiout.js` | Web MIDI: Eingänge lesen, Noten senden. |
| `src/main.js` | Start, Menüs, Speichern, Abgleich mit `modules/`. |
| `scripts/` | `vendor`, `build`, `serve`, `check`, `modules`, `probe`. |
