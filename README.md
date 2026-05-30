# Nodify

Nodify je multiplatformová mobilná aplikácia na tvorbu, úpravu, vizualizáciu a prenos myšlienkových máp medzi mobilným zariadením a bežnými desktopovými nástrojmi.

Projekt vzniká ako praktická časť bakalárskej práce na **Univerzite Komenského v Bratislave**. Zameriava sa najmä na interoperabilitu formátov **XMind (.xmind)** a **FreeMind (.mm)**, dotykové ovládanie editora a offline-first prístup s voliteľnou cloudovou synchronizáciou.

## Hlavné Funkcie

- vytváranie, úprava, mazanie a preusporiadanie uzlov myšlienkovej mapy,
- pan, zoom a drag interakcie optimalizované pre dotykové zariadenia,
- import a export máp vo formátoch **FreeMind (.mm)** a **XMind (.xmind)**,
- lokálne offline ukladanie pomocou AsyncStorage,
- používateľské účty a cloudová synchronizácia cez Supabase,
- riešenie konfliktov pri úpravách tej istej mapy na viacerých zariadeniach,
- anonymný režim bez cloudovej synchronizácie,
- vizuálne indikátory stavu synchronizácie,
- optimalizované renderovanie veľkých máp s limitovaným počtom spracovaných hrán za rámec,
- reprodukovateľné benchmarky výkonu editora v priečinku `benchmarks/`.

## Tech Stack

- **React Native** a **Expo** - multiplatformová aplikácia pre Android a iOS
- **TypeScript** - typová bezpečnosť a udržiavateľná kódová základňa
- **Expo Router** - navigácia založená na súboroch
- **react-native-svg** - renderovanie uzlov, hrán a vizuálnych prvkov mapy
- **react-native-gesture-handler**, **Reanimated** a zoom knižnice - dotykové gestá, pan a zoom
- **AsyncStorage** - lokálne offline úložisko
- **Supabase** - autentifikácia a cloudová synchronizácia
- **Jest** - jednotkové testy importu, exportu, dátového modelu a úložiska

## Požiadavky

- Node.js
- npm
- Expo tooling
- Android Studio alebo fyzické Android zariadenie pre lokálne testovanie
- účet Expo/EAS pre cloudový Android build

## Lokálne Spustenie

Nainštalovanie závislostí:

```bash
npm install
```

Spustenie Expo vývojového servera:

```bash
npm start
```

Aplikáciu je možné otvoriť pomocou:

- **Expo Go** na fyzickom zariadení,
- Android emulátora,
- iOS simulátora na macOS.

Pre natívne Android spustenie:

```bash
npm run android
```

## Konfigurácia Prostredia

Aplikácia používa Supabase pre prihlásenie a synchronizáciu. Lokálne hodnoty sa načítavajú z `.env`:

```bash
EXPO_PUBLIC_SUPABASE_URL=...
EXPO_PUBLIC_SUPABASE_ANON_KEY=...
```

Pri EAS builde musia byť tieto hodnoty dostupné aj v prostredí buildu, inak bude zostavená aplikácia fungovať iba bez cloudových funkcií.

## Testovanie

Základné overenie kódu:

```bash
npx tsc --noEmit
npx jest
npm run lint
```

Reprodukovateľné meranie výkonu editora:

```bash
npm run benchmark
```

Výstupy benchmarku:

- `benchmarks/results.csv` - surové namerané opakovania,
- `benchmarks/summary.csv` - agregované mediány a IQR,
- `benchmarks/table.tex` - tabuľka pre LaTeX,
- `benchmarks/frame-time.svg` - graf času rámca,
- `benchmarks/methodology.sk.md` - metodika merania v slovenčine.

## Android APK Build A Inštalácia

Pre vytvorenie inštalovateľného Android APK buildu sa používa EAS profil `preview`. Tento profil je nastavený v `eas.json` tak, aby generoval súbor `.apk`, ktorý je možné nainštalovať priamo na Android zariadenie.

Aktuálny testovací APK build je dostupný na adrese:

https://expo.dev/accounts/nicolasray/projects/Nodify/builds/956f2d2f-2d89-47ca-94ad-a5381a7f3fe2

Prihlásenie do Expo účtu:

```bash
npx eas-cli@latest login
```

Spustenie Android APK buildu:

```bash
npx eas-cli@latest build -p android --profile preview
```

Po dokončení buildu EAS vypíše URL odkaz. Postup inštalácie:

1. Otvorte vygenerovaný odkaz na Android zariadení.
2. Stiahnite súbor `.apk`.
3. Ak vás systém vyzve, povoľte inštaláciu aplikácií z prehliadača alebo správcu súborov.
4. Nainštalujte aplikáciu Nodify.
5. Po spustení overte anonymný režim, prihlásenie, lokálne ukladanie, import/export a synchronizáciu.

Produkčný build pre Google Play sa vytvára samostatným profilom:

```bash
npx eas-cli@latest build -p android --profile production
```

Profil `production` generuje Android App Bundle (`.aab`), nie priamo inštalovateľný APK.

## Odporúčaný Kontrolný Zoznam Pred Odovzdaním

- aplikácia sa spustí bez pádu,
- anonymný režim vie vytvoriť, upraviť a znova načítať mapu,
- prihlásený používateľ vie uložiť mapu do cloudu,
- offline zmeny sa po obnovení internetu synchronizujú,
- konflikt medzi lokálnou a cloudovou verziou zobrazí dialóg výberu verzie,
- import `.mm` a `.xmind` súborov zachová základnú stromovú štruktúru,
- exportované súbory je možné znova otvoriť,
- veľké mapy sa dajú posúvať a približovať bez kritického zasekávania,
- `npx tsc --noEmit` a `npx jest` prejdú bez chýb.

## Štruktúra Projektu

- `app/` - obrazovky a navigácia Expo Routera
- `src/screens/` - hlavné obrazovky aplikácie
- `src/screens/mapScreen/` - editor myšlienkovej mapy, routing hrán a rozloženie
- `src/components/` - zdieľané UI komponenty editora
- `src/types/` - dátové typy mapy a metadata
- `src/storage/` - lokálne úložisko, cloudové úložisko a synchronizácia
- `src/import/` - import FreeMind a XMind súborov
- `src/export/` - export FreeMind a XMind súborov
- `src/auth/` - autentifikácia a session stav
- `src/i18n/` - jazykové preklady
- `benchmarks/` - reprodukovateľné merania výkonu

## Verejné Dátové Typy

### `MindMapNode`

Umiestnenie: `src/types/map.ts`

Reprezentuje jeden uzol myšlienkovej mapy. Obsahuje identifikátor, názov, rodiča, zoznam detí, súradnice, vizuálne vlastnosti, poznámky, značky a voliteľné prílohy.

### `MindMap`

Umiestnenie: `src/types/map.ts`

Reprezentuje celý dokument myšlienkovej mapy. Obsahuje identifikátor mapy, názov, koreňový uzol, slovník uzlov a voľné vzťahové hrany medzi uzlami.

### `MapMeta`

Umiestnenie: `src/types/map.ts`

Reprezentuje metadata uložených máp. Obsahuje informácie o názve, dátumoch vytvorenia a úpravy, pôvode mapy, stave synchronizácie a poliach `pendingSyncAt` a `lastSyncedAt` pre offline-first synchronizáciu.

## Bakalárska Práca

Repozitár je súčasťou praktickej implementácie bakalárskej práce na **Univerzite Komenského v Bratislave**.

Práca sa zameriava na:

- analýzu formátov XMind a FreeMind,
- návrh mobilného editora myšlienkových máp,
- interoperabilitu medzi desktopovými nástrojmi a mobilným klientom,
- offline ukladanie a synchronizáciu naprieč zariadeniami,
- meranie výkonu editora pri práci s veľkými mapami.

## Zhrnutie

Nodify poskytuje mobilný editor myšlienkových máp s podporou importu a exportu bežných formátov, lokálnym offline ukladaním a voliteľnou cloudovou synchronizáciou. Aktuálna verzia slúži ako funkčný prototyp pre bakalársku prácu a zároveň ako základ pre ďalší vývoj plnohodnotnej multiplatformovej aplikácie.
