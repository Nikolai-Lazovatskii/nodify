# Nodify

Nodify je mobilná aplikácia na tvorbu, úpravu, vizualizáciu a prenos myšlienkových máp medzi mobilným zariadením a bežnými desktopovými nástrojmi.

Projekt vznikol ako praktická časť bakalárskej práce na **Univerzite Komenského v Bratislave**. Zameriava sa najmä na interoperabilitu formátov **XMind (.xmind)** a **FreeMind (.mm)**, dotykové ovládanie editora a offline-first prístup s voliteľnou cloudovou synchronizáciou.

## Hlavné funkcie

- vytváranie, úprava, mazanie a preusporiadanie uzlov myšlienkovej mapy,
- pan, zoom a drag interakcie optimalizované pre dotykové zariadenia,
- import a export máp vo formátoch **FreeMind (.mm)** a **XMind (.xmind)**,
- lokálne offline ukladanie pomocou AsyncStorage,
- používateľské účty a cloudová synchronizácia cez Supabase,
- detekcia konfliktov pri úpravách tej istej mapy na viacerých zariadeniach (offline úpravy sa neprepíšu cloudovou verziou; plnohodnotné riešenie konfliktov je predmetom ďalšieho vývoja),
- anonymný režim bez cloudovej synchronizácie,
- vizuálne indikátory stavu synchronizácie,
- optimalizované renderovanie veľkých máp s limitovaným počtom spracovaných hrán za rámec,
- reprodukovateľné benchmarky výkonu editora v priečinku `benchmarks/`.

## Tech stack

- **React Native** a **Expo** - multiplatformová aplikácia pre Android a iOS
- **TypeScript** - typová bezpečnosť a udržiavateľná kódová základňa
- **Expo Router** - navigácia založená na súboroch
- **react-native-svg** - renderovanie uzlov, hrán a vizuálnych prvkov mapy
- **react-native-gesture-handler**, **Reanimated** a zoom knižnice - dotykové gestá, pan a zoom
- **AsyncStorage** - lokálne offline úložisko
- **Supabase** - autentifikácia a cloudová synchronizácia
- **Jest** - jednotkové testy importu, exportu, dátového modelu a úložiska

## Požiadavky

- **Node.js** 22.13.1 alebo novší (≥ 22)
- **npm** (dodávané s Node.js)
- **Expo SDK** ~54 a **Expo CLI**
- **React Native** 0.81.5 (spravované cez Expo)
- **Android Studio** alebo fyzické Android zariadenie pre lokálne testovanie
- účet **Expo/EAS** pre cloudový Android build

## Lokálne spustenie

Inštalácia závislostí:

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

## Konfigurácia prostredia

Aplikácia používa Supabase pre prihlásenie a synchronizáciu. Pre lokálne spustenie skopírujte vzorový súbor a doplňte vlastné hodnoty:

```bash
cp .env.example .env
```

```bash
EXPO_PUBLIC_SUPABASE_URL=...
EXPO_PUBLIC_SUPABASE_ANON_KEY=...
```

Uvádza sa výhradne verejný (anon) kľúč, ktorý je pri zapnutej Row Level Security bezpečné sprístupniť v klientovi. Servisný (`service_role`) kľúč ani reálny súbor `.env` so súkromnými údajmi nikdy nepatria do repozitára.

Bez týchto hodnôt aplikácia spustená zo zdrojového kódu funguje v anonymnom/offline režime (cloudové funkcie sú vypnuté). Pre plnú reprodukciu cloudových funkcií zo zdrojového kódu je potrebný vlastný Supabase projekt so zodpovedajúcou databázovou schémou; plný cloudový režim je zároveň dostupný cez priložený APK build napojený na referenčný backend.

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

## Android APK build a inštalácia

Pre vytvorenie inštalovateľného Android APK buildu sa používa EAS profil `preview`. Tento profil je nastavený v `eas.json` tak, aby generoval súbor `.apk`, ktorý je možné nainštalovať priamo na Android zariadenie.

Aktuálny testovací APK build je dostupný na adrese:

https://expo.dev/accounts/nicolasray/projects/Nodify/builds/7f9273ea-1811-4db2-a5d4-96c4798cd8a7

Inštalovateľný `.apk` je priložený aj v elektronickej prílohe záverečnej práce v systéme AIS.

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

Na iOS je aplikáciu možné spustiť cez Expo Go alebo iOS simulátor (macOS); samostatný iOS build nie je súčasťou tohto repozitára a vyžaduje Apple Developer účet.

Produkčný build pre Google Play sa vytvára samostatným profilom:

```bash
npx eas-cli@latest build -p android --profile production
```

Profil `production` generuje Android App Bundle (`.aab`), nie priamo inštalovateľný APK.

## Štruktúra projektu

- `app/` - obrazovky a navigácia Expo Routera
- `src/screens/` - hlavné obrazovky aplikácie
- `src/screens/mapScreen/` - editor myšlienkovej mapy, routing hrán a rozloženie
- `src/components/` - zdieľané UI komponenty editora
- `src/types/` - dátové typy mapy a metadata
- `src/storage/` - lokálne úložisko, cloudové úložisko a synchronizácia
- `src/import/` - import FreeMind a XMind súborov
- `src/export/` - export FreeMind a XMind súborov
- `src/auth/` - autentifikácia a session stav
- `src/lang/` - jazykové preklady
- `benchmarks/` - reprodukovateľné merania výkonu

## Verejné dátové typy

### `MindMapNode`

Umiestnenie: `src/types/map.ts`

Reprezentuje jeden uzol myšlienkovej mapy. Obsahuje identifikátor, názov, rodiča, zoznam detí, súradnice, vizuálne vlastnosti, poznámky, značky a voliteľné prílohy.

### `MindMap`

Umiestnenie: `src/types/map.ts`

Reprezentuje celý dokument myšlienkovej mapy. Obsahuje identifikátor mapy, názov, koreňový uzol, slovník uzlov a voľné vzťahové hrany medzi uzlami.

### `MapMeta`

Umiestnenie: `src/types/map.ts`

Reprezentuje metadata uložených máp. Obsahuje informácie o názve, dátumoch vytvorenia a úpravy, pôvode mapy, stave synchronizácie a poliach `pendingSyncAt` a `lastSyncedAt` pre offline-first synchronizáciu.

## Bakalárska práca

Repozitár je súčasťou praktickej implementácie bakalárskej práce na **Univerzite Komenského v Bratislave**.

Práca sa zameriava na:

- analýzu formátov XMind a FreeMind,
- návrh mobilného editora myšlienkových máp,
- interoperabilitu medzi desktopovými nástrojmi a mobilným klientom,
- offline ukladanie a synchronizáciu naprieč zariadeniami,
- meranie výkonu editora pri práci s veľkými mapami.

Oficiálna webová stránka:
https://davinci.fmph.uniba.sk/~lazovatskii1/

## Zhrnutie

Nodify poskytuje mobilný editor myšlienkových máp s podporou importu a exportu bežných formátov, lokálnym offline ukladaním a voliteľnou cloudovou synchronizáciou. Aktuálna verzia slúži ako funkčný prototyp pre bakalársku prácu a zároveň ako základ pre ďalší vývoj plnohodnotnej multiplatformovej aplikácie.
