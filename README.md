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

`dist/` enthält alles, etwa 7 MB, davon 6,5 MB Faust-Compiler. Jeder Webserver für statische Dateien genügt. Der Browser erlaubt AudioWorklets aber nur über HTTPS oder `localhost`.

COOP- und COEP-Header braucht die Seite nicht, weil sie keinen `SharedArrayBuffer` benutzt.

## Prüfen

```sh
npm run check     # oder: node scripts/check.mjs dist bild.png
```

Das Skript lädt `dist/` in Chromium ohne Fenster. Es schlägt fehl, wenn ein Modul nicht kompiliert, ein Beispielpatch kein Signal am Ausgang liefert oder die Konsole einen Fehler zeigt. Es zieht auch ein Kabel und einen Regler mit der Maus und tauscht ein Modul im Betrieb.

## Aufbau

| Pfad | Aufgabe |
| --- | --- |
| `modules/` | Die Module. [MODULES.md](MODULES.md) beschreibt das Format. |
| `patches/` | Beispielpatches und ihre Liste. |
| `src/faust.js` | Lädt und kompiliert Module, erkennt Änderungen. |
| `src/rack.js` | Audio-Graph und Patch-Zustand, ohne DOM. |
| `src/ui.js` | Module, Regler und Kabel im DOM. |
| `src/keyboard.js` | Bildschirm- und Computertastatur. |
| `src/main.js` | Start, Menüs, Speichern, Abgleich mit `modules/`. |
| `scripts/` | `vendor`, `build`, `serve`, `check`. |
