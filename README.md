# Nodify 🧠

Nodify je multiplatformová mobilná aplikácia určená na tvorbu, úpravu a vizualizáciu myšlienkových máp.

Tento projekt je vyvíjaný ako súčasť bakalárskej práce na **Univerzite Komenského v Bratislave**. Hlavné zameranie je na:

* podporu široko používaných formátov myšlienkových máp **XMind (.xmind)** a **FreeMind (.mm)**,
* interoperabilitu medzi desktopovými nástrojmi a mobilným klientom,
* moderné, dotykové používateľské rozhranie s plynulými interakciami,
* prístup "offline-first" s možnosťou pridania cloudovej synchronizácie naprieč zariadeniami.

Cieľom je poskytnúť praktický nástroj, ktorý používateľom umožní:

* otvárať existujúce myšlienkové mapy vytvorené v iných aplikáciách,
* pracovať s nimi na mobilných zariadeniach,
* a ukladať ich späť v kompatibilných formátoch bez straty základnej štruktúry mapy.

---

## Tech Stack

Nodify je postavený na:

* **React Native** + **Expo** – multiplatformová aplikácia pre Android a iOS
* **TypeScript** – typová bezpečnosť a udržiavateľná kódová základňa
* **Expo Router** – navigácia založená na súboroch
* **react-native-svg** – renderovanie uzlov a spojení
* **react-native-gesture-handler** / **Reanimated** (plánované) – pan, zoom, drag a interakcie
* **AsyncStorage / SQLite** (plánované) – lokálne offline úložisko
* **Firebase / Supabase / custom backend** (plánované) – cloudová synchronizácia

---

## How to Run

```bash
npm install
npx expo start
```

Aplikáciu môžete spustiť pomocou:

* **Expo Go** na fyzickom zariadení
* **Android** alebo **iOS** simulátora

Uistite sa, že máte nainštalovaný Node.js a nástroje Expo.

---

## Current Status (MVP Prototype)

Aktuálna verzia predstavuje raný základ MVP:

* základný projekt Expo s jasnou štruktúrou (`app/`, `src/`),
* interný dátový model pre myšlienkové mapy (`MindMap`, `MindMapNode`),
* základná SVG vizualizácia vzorovej myšlienkovej mapy založenej na tomto modeli,
* pripravená architektúra pre:
    * interakciu s uzlami (výber, úprava),
    * pan & zoom (bude implementované),
    * import/export `.mm` (FreeMind) a `.xmind` (XMind) (bude implementované).

Toto úložisko slúži ako:

* **praktická implementácia** pre bakalársku prácu, a
* **východiskový bod** pre ďalší vývoj do produkčnej verzie editora myšlienkových máp.

---

## Project Roadmap

1.  **Jadro editora myšlienkových máp**
    * pridávanie, úprava a mazanie uzlov,
    * základné automatické rozloženie okolo koreňového uzla.

2.  **Interoperabilita**
    * export do formátov **FreeMind (.mm)** a JSON-založeného formátu **XMind**,
    * zachovanie základnej stromovej štruktúry medzi nástrojmi.

3.  **Úložisko & Synchronizácia**
    * offline úložisko v zariadení (AsyncStorage / SQLite),
    * voliteľná cloudová synchronizácia (Firebase / Supabase / custom backend).

4.  **UX & Rozšírenia**
    * vylepšená vizuálna stránka (témy, farby, ikony),
    * plynulé gestá (pan, zoom, drag),
    * základy pre budúce funkcie asistované AI.

---

## Bachelor Thesis Context

Toto úložisko je súčasťou praktickej implementácie bakalárskej práce na **Univerzite Komenského v Bratislave**.

Práca sa zameriava na:

* analýzu XMind a FreeMind a ich súborových formátov,
* návrh mobilnej aplikácie umožňujúcej interoperabilitu medzi týmito formátmi,
* implementáciu MVP demonštrujúceho vizualizáciu a interné dátové štruktúry,
* načrtnutie ďalších krokov smerom k plne použiteľnému multiplatformovému editoru myšlienkových máp.

---

## Public API Documentation

Táto sekcia dokumentuje hlavné verejné typy a komponenty aktuálne vystavené v projekte. Je určená pre prispievateľov a pre dokumentáciu k práci.

### Type: `MindMapNode`

**Location:** `src/types/Map.ts` (alebo ekvivalent)

Reprezentuje jeden uzol (tému) v myšlienkovej mape.

**Fields:**

* `id: string`
    Unikátny identifikátor uzla.
* `parentId: string | null`
    Identifikátor rodičovského uzla. `null` pre koreňový uzol.
* `title: string`
    Textový popis zobrazený v uzle.
* `x: number`, `y: number`
    Relatívne súradnice uzla v rámci logického rozloženia mapy (používa renderer).
* `children: string[]`
    Zoznam identifikátorov priamych detských uzlov.

**Usage:**

* Tvorí základnú stromovú štruktúru mapy.
* Používajú ju renderovacie komponenty na vyriešenie vzťahov a pozícií.

---

### Type: `MindMap`

**Location:** `src/types/Map.ts` (alebo ekvivalent)

Reprezentuje celý dokument myšlienkovej mapy.

**Fields:**

* `id: string`
    Unikátny identifikátor mapy.
* `title: string`
    Ľudsky čitateľný názov mapy.
* `rootId: string`
    Identifikátor koreňového uzla (musí zodpovedať kľúču v `nodes`).
* `nodes: Record<string, MindMapNode>`
    Slovník všetkých uzlov v mape, indexovaný podľa ID uzla.

**Usage:**

* Slúži ako in-memory model pre vizualizáciu,
* Predstavuje zdrojovú štruktúru pre budúci import/export do FreeMind (.mm) a XMind (.xmind).

---

### Component: `MindMapCanvas`

**Location:** `src/components/MindMapCanvas.tsx`

Zodpovedný za vizuálne renderovanie danej `MindMap` pomocou SVG.

**Props:**

* `map: MindMap` (povinné)
    Dáta mapy, ktoré sa majú renderovať.

**Behavior:**

* Vypočíta umiestnené uzly (absolútne súradnice) z logického modelu.
* Vykreslí:
    * spojovacie čiary medzi rodičovskými a detskými uzlami,
    * kruhové uzly pre témy,
    * textové popisy pre každý uzol.
* Navrhnutý tak, aby bol rozšírený o:
    * interaktívny výber uzlov,
    * spätnú väzbu pri prejdení myšou/ťuknutí,
    * transformácie pan a zoom.

**Notes:**

* Používa `react-native-svg` pre všetky grafické prvky.
* Udržiava obavy z renderovania oddelené od stavu aplikácie a navigácie.

---

### Screen: `MapScreen`

**Location:** `src/screens/MapScreen.tsx`

Obrazovka najvyššej úrovne zobrazujúca myšlienkovú mapu v aplikácii.

**Responsibilities:**

* Poskytuje vzorovú `MindMap` (mock dáta) počas fázy MVP.
* Renderuje:
    * názov stránky a základné textové informácie,
    * komponent `MindMapCanvas` s danými dátami mapy.
* V neskorších fázach bude:
    * spravovať stav vybraného uzla,
    * integrovať ovládacie prvky úprav (pridať/odstrániť/premenovať),
    * načítavať a ukladať mapy z trvalého úložiska.

**Export:**

* Predvolený export modulu, používaný Expo Router ako jedna z hlavných obrazoviek.

---

## Slovak Summary

Nodify je multiplatformová mobilná aplikácia určená na tvorbu, úpravu a vizualizáciu myšlienkových máp, vyvíjaná ako súčasť bakalárskej práce na Univerzite Komenského v Bratislave. Cieľom je podporovať formáty **XMind (.xmind)** a **FreeMind (.mm)**, zlepšiť interoperabilitu medzi desktopovými nástrojmi a mobilnou aplikáciou, umožniť offline prácu a pripraviť priestor pre budúcu cloudovú synchronizáciu. Aktuálna verzia predstavuje MVP zamerané na dátový model, základnú vizualizáciu a návrh architektúry pre ďalší rozvoj aplikácie.