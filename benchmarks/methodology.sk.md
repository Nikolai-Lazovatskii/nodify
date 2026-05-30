# Meranie výkonu

Meranie výkonu bolo spustené na vývojovom zariadení MacBook-Air-Nicolas.local / Apple M1 / 8 GB RAM (Darwin 25.4.0 arm64, Node.js v22.13.1) s verziami Expo ~54.0.22 a React Native 0.81.5. Pre každú veľkosť syntetickej mapy N ∈ {50, 100, 250, 500, 1000} bol použitý deterministický generátor so seedom 20260530; mapy obsahovali realistickú stromovú štruktúru a približne 10 % voľných vzťahov. Pred meraním prebehli 2 zahrievacie opakovania a následne 8 meraných opakovaní pre každú konfiguráciu. Skript meral čas funkcie layoutStructuredMap, CPU čas simulovaného rámca pri pan/zoom trajektórii, čas routovania hrán, počet skutočne spracovaných hrán a vrcholové využitie JS heap. FPS je odvodené ako 1000 / medián času simulovaného rámca; nejde o profilovanie natívneho vykresľovania na zariadení, pretože toto meranie prebieha mimo Expo runtime. Výsledky sú uvádzané mediánom a medzikvartilovým rozpätím.

## Konfigurácie

- Baseline: 40 meraných riadkov.
- Optimized: 40 meraných riadkov.
- Bez viewport cullingu: 40 meraných riadkov.
- Bez selektívneho routingu: 40 meraných riadkov.
- Bez throttlingu transformácií: 40 meraných riadkov.

## Poznámka k interpretácii

Pri najväčšej mape mal baseline medián simulovaného rámca 0.36 ms, zatiaľ čo optimalizovaná konfigurácia mala 0.2 ms. Súbor results.csv obsahuje surové opakovania merania a summary.csv agregované mediány s IQR.
Ablácia bez cache trás je dostupná prepínačom --conditions=noRouteCache, ale nie je súčasťou predvoleného behu, pretože pri malých mapách zámerne vytvára extrémne pomalý stresový scenár routovania.
