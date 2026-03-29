# DataCompare Pro — PWA aggiornata

Versione corretta e resa più pulita per GitHub Pages.

## Cosa è stato sistemato
- struttura coerente con cartella `src/`
- manifest aggiornato con icone PNG reali
- service worker aggiornato
- UI rifinita in stile dark minimal
- aggiunta icona SVG + icone PNG 192/512
- mantenuta logica di confronto, analisi PDF, catalogo e preventivi locali

## Struttura
```
datacompare-pro-fixed/
├── index.html
├── manifest.json
├── icon.svg
├── icon-192.png
├── icon-512.png
├── sw.js
├── README.md
└── src/
    ├── style.css
    └── app.js
```

## Deploy
Pubblica la cartella così com'è nella root della repo GitHub Pages.


## Fix v3
- Le immagini estratte dal PDF ora vengono mantenute anche nel catalogo e nel preventivo.
- Il drawer del preventivo mostra la miniatura articolo quando disponibile.
- Export CSV del preventivo esteso con fonte e pagina PDF.
- Cache Service Worker aggiornata per forzare refresh più affidabile.
