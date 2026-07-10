# Aufzug – Spielleiter

Eine kleine, installierbare Web-App zum Zählen von Ansagen, Stichen und Punkten beim Kartenspiel **Aufzug**.

Die App enthält einen gemeinsamen Zugangscode, automatische Wiederaufnahme auf demselben Gerät, feste Spieler (`BP`, `MR`, `MA`, `TB`, `TS`, `KS`, `KK`), frei ergänzbare Gäste und eine Langzeitstatistik aller abgeschlossenen Partien.

## Enthaltene Regeln

- Zwei Kartendecks von 7 bis Ass, insgesamt 64 Karten.
- Maximal `min(11, floor(63 / Spielerzahl))` Karten je Spieler.
- Rundenfolge von 1 bis zum Maximum und wieder zurück auf 1; der Höchstwert wird einmal gespielt.
- In Ein-Karten-Runden bleibt die Aufdeckkarte verdeckt, sonst wird die nächste Karte als Trumpf aufgedeckt.
- Die Summe aller Ansagen darf nicht genau der Anzahl möglicher Stiche entsprechen.
- Bei der Auswertung werden die tatsächlich gemachten Stiche frei und unabhängig eingetragen.
- Exakt erfüllt: `10 + 2 × Ansage`; nicht erfüllt: `−2 × Abweichung`.
- Vor dem Spiel wird ausgewählt, wer zuerst mischt. Der Mischer wechselt danach jede Runde im Kreis. Die Person direkt danach beginnt mit dem Ansagen; der Mischer sagt zuletzt an.

## Lokal starten

```bash
npm test
npm start
```

Danach `http://localhost:4173` öffnen. Ein direkter Doppelklick auf `index.html` ist wegen Service Worker und JavaScript-Modulen nicht vorgesehen.

## Online bereitstellen

Der gesamte Ordner kann unverändert auf einem statischen HTTPS-Webspace veröffentlicht werden, beispielsweise mit GitHub Pages. Es gibt kein Backend, kein Login, keine Werbung und keine Analyse-Skripte. Der Spielstand bleibt ausschließlich im Browser des Spielleiter-Geräts und wird automatisch gespeichert.

## Datenschutz und Sicherung

Die App sendet keine Spiel- oder Namensdaten an einen Server. Über **Menü → Gesamtsicherung exportieren** lassen sich laufende Partie, Spielarchiv und Spielerauswahl als JSON-Datei sichern und auf demselben oder einem anderen Gerät wieder importieren. Der gemeinsame Code wird nicht exportiert.
