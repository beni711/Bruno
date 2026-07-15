# Bruno – Spielleiter

Eine kleine, installierbare Web-App zum Zählen von Ansagen, Stichen und Punkten beim Kartenspiel **Bruno**.

Die App verwendet den gemeinsamen Online-Sitzungscode `111111`, synchronisiert die laufende Partie über Firebase, speichert zusätzlich lokal, enthält die festen Spieler Beni, Kevin, Keven, Tobi B., Tobi S., Max und Michi, erlaubt Gäste und führt eine Langzeitstatistik aller abgeschlossenen Partien. Unter **Menü → Vergangene Spiele** stehen die Partien – neueste zuerst – jeweils mit Datum, Gewinner, Spielerzahl, Rundenzahl und vollständigem Endstand.

Die Ansagen werden direkt und dauerhaft in der jeweiligen Rundenseite eingetragen. Ein Tipp auf eine Stichzahl speichert die Ansage sofort, zeigt ungefähr 1,3 Sekunden lang nur den Spielernamen und die gewählte Zahl an und wechselt dann automatisch zur nächsten Person. Die großen Summenfelder entfallen; die Spielerliste zeigt die Ansage jeder Person kompakt als Zahl in einem Quadrat und den für die letzte Person gesperrten Wert.

Nach den Ansagen erscheint zuerst „Runde läuft“ mit den Schaltflächen **Zurück** und **Stiche auswerten**. Die Rundenauswertung öffnet danach ohne Popup direkt in der Rundenseite. Dort zeigt die Spielerliste Ansage und gemachte Stiche je Person. Ein Tipp auf die tatsächlich gemachten Stiche wechselt sofort weiter; sobald alle verfügbaren Stiche verteilt sind, werden offene Ergebnisse mit 0 ergänzt und die Punkte direkt berechnet.

## Enthaltene Regeln

- Zwei Kartendecks von 7 bis Ass, insgesamt 64 Karten.
- Maximal `min(11, floor(63 / Spielerzahl))` Karten je Spieler.
- Rundenfolge von 1 bis zum Maximum und wieder zurück auf 1; der Höchstwert wird einmal gespielt.
- In Ein-Karten-Runden bleibt die Aufdeckkarte verdeckt, sonst wird die nächste Karte als Trumpf aufgedeckt.
- Die Summe aller Ansagen darf nicht genau der Anzahl möglicher Stiche entsprechen.
- Bei der Auswertung müssen die tatsächlich gemachten Stiche zusammen genau der Kartenanzahl entsprechen. Sobald alle Stiche verteilt sind, werden noch offene Spieler automatisch mit 0 eingetragen.
- Exakt erfüllt: `10 + 2 × Ansage`; nicht erfüllt: `−2 × Abweichung`.
- Zusätzliche Strafen je Spieler und Runde: `−20` für „Nicht Trumpf gespielt“ und `−2` für „Zu früh gespielt“. Beide Strafen können zusammen gelten.
- Vor dem Spiel wird ausgewählt, wer zuerst mischt. Der Mischer wechselt danach jede Runde im Kreis. Die Person direkt danach beginnt mit dem Ansagen; der Mischer sagt zuletzt an.

## Spielprotokoll

Unter dem Punktestand öffnet **Details** ein schlichtes Rundenprotokoll wie auf dem Spielzettel: Kartenanzahl links, Spieler-Kürzel oben, Ansage und laufender Punktestand je Spieler. Richtige Ansagen sind grün hinterlegt; Strafen stehen rechts. Über **PDF öffnen** wird die gesamte Partie kompakt auf einer DIN-A4-Seite im Hochformat bereitgestellt. In der Schlusszeile stehen die Zahlbeträge; der Sieger erhält eine Krone und nicht mitspielende feste Spieler zahlen den Durchschnitt.

## Lokal starten

```bash
npm test
npm start
```

Danach `http://localhost:4173` öffnen. Ein direkter Doppelklick auf `index.html` ist wegen Service Worker und JavaScript-Modulen nicht vorgesehen.

## Online bereitstellen

Der gesamte Ordner kann auf einem statischen HTTPS-Webspace wie GitHub Pages veröffentlicht werden. Die Firebase Realtime Database übernimmt die Online-Synchronisierung; ein persönliches Login, Werbung und Analyse-Skripte werden nicht verwendet.

## Datenschutz und Sicherung

Spielstand, Spielernamen, Auswahl und Spielarchiv werden unter der Sitzung `111111` in der Firebase Realtime Database gespeichert. Eine lokale Kopie bleibt als Offline-Ausfallsicherung bestehen. Beim Laden auf einem neuen Gerät stellt die App von Firebase entfernte leere Rundendaten automatisch wieder her. Über **Menü → Gesamtsicherung exportieren** lassen sich laufende Partie, Spielarchiv und Spielerauswahl zusätzlich als JSON-Datei sichern und wieder importieren. Die empfohlenen Datenbankregeln stehen in `firebase-rules.json`.
