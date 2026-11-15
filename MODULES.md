# Modulformat

Ein Modul besteht aus zwei Dateien in `modules/` und einem Eintrag in `modules/index.json`.

| Datei | Inhalt |
| --- | --- |
| `modules/<id>.dsp` | Der Klang, als Faust-Programm. |
| `modules/<id>.json` | Name, Farbe und Buchsen. |
| `modules/index.json` | Liste aller IDs. Die Reihenfolge ist die Reihenfolge im Menü **+ Modul**. |

Die `<id>` besteht aus Kleinbuchstaben und Ziffern.

Das laufende Rack liest `modules/` alle 3 Sekunden neu. Ein neues Modul erscheint im Menü, ohne dass du die Seite lädst. Ein geändertes Modul ersetzt seine laufenden Exemplare. Reglerwerte und Kabel bleiben, soweit die neue Version den Regler oder die Buchse noch hat. Wenn ein Modul nicht kompiliert, läuft die letzte funktionierende Version weiter und die Statuszeile zeigt den Faust-Fehler.

## Mini-Beispiel

`modules/ringmod.dsp`:

```faust
import("stdfaust.lib");

mix = hslider("[0]Mix", 1, 0, 1, 0.01) : si.smoo;

process(a, b) = a * (1 - mix) + a * b * mix;
```

`modules/ringmod.json`:

```json
{
	"name": "Ringmod",
	"description": "Multipliziert zwei Signale. Klingt metallisch.",
	"color": "#9bc53d",
	"inputs": [
		{ "name": "A", "kind": "audio" },
		{ "name": "B", "kind": "audio" }
	],
	"outputs": [{ "name": "Out", "kind": "audio" }]
}
```

Trage danach `"ringmod"` in `modules/index.json` ein.

`npm run modules` kompiliert alle Module in `modules/` ohne Browser und zeigt Fehler, Buchsen und Regleradressen. Prüfe ein neues Modul damit, bevor du es in `index.json` einträgst.

## Felder der JSON-Datei

| Feld | Pflicht | Bedeutung |
| --- | --- | --- |
| `name` | ja | Titel auf dem Modul. |
| `description` | nein | Ein bis zwei Sätze für Einsteiger. Erscheint im Menü und als Tooltip. |
| `color` | nein | CSS-Farbe für den Streifen und die Regler. |
| `group` | nein | Überschrift im Menü **+ Modul**. Module mit derselben Gruppe stehen zusammen. |
| `inputs` | ja | Eine Buchse je Eingang von `process`, in derselben Reihenfolge. |
| `outputs` | ja | Eine Buchse je Ausgang von `process`, in derselben Reihenfolge. |
| `columns` | nein | Regler pro Zeile. Vorgabe ist 2. |
| `speakers` | nein | `true` schickt die zwei Ausgänge des Moduls an die Lautsprecher. `outputs` entfällt dann. |
| `microphone` | nein | `true` speist die zwei Eingänge des Moduls aus dem Audio-Eingang des Rechners. `inputs` entfällt dann. |
| `display` | nein | Die Live-Anzeige im Modul. Vorgabe ist `"scope"`: der erste Audio-Ausgang als Welle, sonst der erste Ausgang als Verlauf der letzten drei Sekunden. `"adsr"` zeichnet die Hüllkurve mit laufendem Punkt und braucht die Regler Attack, Decay, Sustain, Release. `"filter"` zeichnet die Filterkurve und braucht Cutoff, Resonanz, CV-Anteil. `"none"` zeigt nichts. |
| `widget` | nein | Zusätzliches Bedienfeld: `"keyboard"`, `"pads"`, `"midiout"` oder `"life"`. |

Eine Buchse hat `name` und `kind`. `kind` ist `audio`, `cv` oder `gate` und bestimmt nur die Farbe. Jede Buchse lässt sich mit jeder verbinden.

Die Zahl der Buchsen muss zu `process` passen. Wenn `inputs` zwei Einträge hat und `process` drei Eingänge, lädt das Modul nicht und die Statuszeile nennt beide Zahlen.

## Regler

Das Rack baut die Bedienelemente aus den UI-Elementen des Faust-Programms.

| Faust | Im Rack |
| --- | --- |
| `hslider`, `vslider`, `nentry` | Drehregler |
| Dasselbe mit genau zwei Werten, zum Beispiel `hslider("Lauf", 1, 0, 1, 1)` | Schalter |
| `nentry` mit `[style:menu{'Dur':0;'Moll':1}]` | Auswahlliste |
| `checkbox` | Schalter, startet immer aus |
| `button` | Taster |
| `hbargraph`, `vbargraph` | Pegelbalken |

Metadaten im Label ändern die Darstellung:

| Metadatum | Wirkung |
| --- | --- |
| `[0]`, `[1]`, … | Reihenfolge. Faust sortiert die Regler sonst nach dem Alphabet. |
| `[unit:Hz]` | Einheit hinter dem Wert. |
| `[scale:log]` | Logarithmischer Regler. Der kleinste Wert muss über 0 liegen. |
| `[rack:hidden]` | Kein Bedienelement. Für Werte, die ein `widget` setzt. |
| `[rack:leds]` | Ein Bargraph zeigt eine Reihe Lämpchen. Der Wert wählt das leuchtende Lämpchen. |

## Signale

Alle Kabel tragen Audiosignale, auch CV und Gate.

- **Audio** liegt zwischen -1 und 1.
- **Tonhöhe** folgt 1 V pro Oktave. 0 ist C4 (261,6 Hz), 1 ist C5, -1 ist C3. Ein Halbton ist 1/12.
- **Gate** ist 0 oder 1. Ein Eingang wertet alles über 0,5 als an.
- **Hüllkurven** liegen zwischen 0 und 1, **LFOs** zwischen -1 und 1.

Mehrere Kabel in einem Eingang addieren sich. Ein offener Eingang liefert 0, also brauchen Regler sinnvolle Grundwerte.

## Hinweise für gute Module

- Glätte Regler mit `si.smoo`, sonst knackt es beim Drehen.
- Begrenze Frequenzen und Verzögerungen mit `min` und `max`. Ein CV-Eingang kann jeden Wert liefern.
- Halte ein Modul klein. Zwei bis vier Regler reichen meistens.
- Ein Kabel, das einen Kreis schließt, verzögert das Rack um 128 Samples. Rückkopplung innerhalb eines Moduls ist samplegenau.
- Ein Regler, den kein Signal benutzt, verschwindet beim Kompilieren. `modules/midiout.dsp` zeigt, wie `attach` ihn behält.

## Widgets

Ein Widget ist JavaScript in `src/` und verbindet versteckte Regler eines Moduls mit der Außenwelt. Es findet die Regler über ihr Label.

| Widget | Erwartet im Faust-Programm | Tut |
| --- | --- | --- |
| `keyboard` | versteckte Regler `gate`, `note` (MIDI-Nummer), `vel`, `bend`, `mod` | Klaviatur, Computertasten und MIDI-Noten |
| `pads` | versteckte Taster `pad1` bis `pad8` | acht Schlagflächen, Tasten 1 bis 8, MIDI-Noten auf Kanal 10 |
| `midiout` | versteckte Bargraphs `note` und `gate`, Regler `Kanal` | schickt MIDI-Noten an alle MIDI-Ausgänge |
| `life` | die versteckten Regler und Bargraphs aus `modules/life.dsp` | rechnet und zeichnet die Welt des Moduls Leben |

Ein neues Widget braucht eine Datei in `src/`, einen Eintrag in `WIDGETS` in `src/ui.js` und einen Build.

## Patchformat

Ein Patch ist eine JSON-Datei. Beispiele liegen in `patches/`, `patches/index.json` listet sie für das Menü **Patches**.

```json
{
	"format": "faust-rack/1",
	"modules": [
		{ "id": "vco1", "type": "vco", "params": { "/vco/Oktave": -1 } },
		{ "id": "output1", "type": "output", "params": {} }
	],
	"cables": [{ "from": ["vco1", 1], "to": ["output1", 0] }]
}
```

Ein Modul mit `"muted": true` ist stummgeschaltet: Es läuft, gibt aber an keiner Buchse etwas aus.

Optional kommt `"midi": [{ "cc": 74, "module": "vcf1", "address": "/vcf/Cutoff" }]` dazu. Jeder Eintrag bindet einen MIDI-Controller an einen Regler.

Optional kommt `"mods": [{ "from": ["lfo1", 0], "to": ["delay1", "/delay/Zeit"], "depth": 0.25 }]` dazu. Jeder Eintrag lässt ein Signal einen Regler bewegen. `depth` liegt zwischen -1 und 1 und ist der Anteil des Reglerwegs, den ein Signal von 1 ausmacht. Die Seite stellt den Regler etwa 85-mal pro Sekunde nach. Für schnelle Hüllkurven ist ein CV-Eingang im Modul genauer.

`type` ist die Modul-ID. `params` nennt nur Regler, die von der Vorgabe abweichen. Der Schlüssel ist die Faust-Adresse `/<id>/<Label>`, Leerzeichen im Label werden zu `_`. Ein Kabel führt von `[Modul, Ausgang]` zu `[Modul, Eingang]`, gezählt ab 0.
