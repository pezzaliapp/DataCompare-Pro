# DataCompare Pro — PWA

Applicazione PWA per confronto e analisi di file Excel, CSV e PDF.

## Funzionalità

### Confronto File
- Carica multipli file Excel (.xlsx, .xls), CSV e PDF contemporaneamente
- Rileva automaticamente la colonna codice, descrizione e prezzo
- Individua: duplicati di codice, prezzi difformi tra fonti, descrizioni conflittuali, codici mancanti
- Filtra i risultati per tipo di anomalia
- Esporta i risultati in CSV

### Analisi PDF Listini
- Carica PDF di listini figurativi
- Configura pattern regex per codici articolo e prezzi
- Estrai automaticamente: codice, descrizione, prezzo, immagine (rendering della pagina)
- Modifica manualmente i dati estratti prima di salvarli
- Esporta in JSON o CSV

### Catalogo & Preventivi
- Raccogli tutti gli articoli estratti in un catalogo centrale
- Cerca per codice o descrizione
- Importa/esporta catalogo in JSON o CSV
- Crea preventivi con calcolo automatico IVA 22%
- Esporta preventivi in CSV

## Deploy su GitHub Pages

```
# Struttura file
datacompare/
├── index.html
├── manifest.json
├── icon.svg
├── sw.js
├── src/
│   ├── style.css
│   └── app.js
└── README.md
```

1. Copia la cartella in un repository GitHub
2. Attiva GitHub Pages dalla root del branch `main`
3. L'app è installabile come PWA da browser mobile e desktop

## Librerie usate (CDN — no build step)
- **XLSX.js** — parsing Excel e CSV
- **PDF.js** — rendering e estrazione testo da PDF
- **pdf-lib** — manipolazione PDF

## Note tecniche
- Zero build step
- Funziona offline dopo prima visita (Service Worker)
- Tutti i dati restano locali nel browser, nulla viene inviato a server
