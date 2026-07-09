# Aufzug – Spielleiter

Eine kleine, installierbare Web-App zum Zählen von Ansagen, Stichen und Punkten beim Kartenspiel **Aufzug**.

## Enthaltene Regeln

- Zwei Kartendecks von 7 bis Ass, insgesamt 64 Karten.
- Maximal `min(11, floor(63 / Spielerzahl))` Karten je Spieler.
- Rundenfolge von 1 bis zum Maximum und wieder zurück auf 1; der Höchstwert wird einmal gespielt.
- In Ein-Karten-Runden bleibt die Aufdeckkarte verdeckt, sonst wird die nächste Karte als Trumpf aufgedeckt.
- Die Summe aller Ansagen darf nicht genau der Anzahl möglicher Stiche entsprechen.
- Exakt erfüllt: `10 + 2 × Ansage`; nicht erfüllt: `−2 × Abweichung`.
- Der Geber rotiert und sagt in seiner Runde zuletzt an.

## Lokal starten

```bash
npm test
npm start
```

Danach `http://localhost:4173` öffnen. Ein direkter Doppelklick auf `index.html` ist wegen Service Worker und JavaScript-Modulen nicht vorgesehen.

## Online bereitstellen

Der gesamte Ordner kann unverändert auf einem statischen HTTPS-Webspace veröffentlicht werden, beispielsweise mit GitHub Pages. Es gibt kein Backend, kein Login, keine Werbung und keine Analyse-Skripte. Der Spielstand bleibt ausschließlich im Browser des Spielleiter-Geräts und wird automatisch gespeichert.

## Datenschutz und Sicherung

Die App sendet keine Spiel- oder Namensdaten an einen Server. Über **Menü → Sicherung exportieren** lässt sich eine laufende Partie als JSON-Datei sichern und auf demselben oder einem anderen Gerät wieder importieren.
