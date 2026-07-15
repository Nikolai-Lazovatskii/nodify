# Nodify: podklady pre nasadenie na serveri katedry

Tento dokument je urceny pre spravcu servera. Repozitar obsahuje mobilnu aplikaciu
Nodify a pripravu serverovej casti pre self-hosted Supabase.

## Co je serverova cast

Nodify momentalne nema vlastny samostatny backend server. Mobilna aplikacia pouziva:

- Supabase Auth na prihlasenie pouzivatelov;
- Supabase Postgres/PostgREST na synchronizaciu map;
- Row Level Security, aby pouzivatel videl iba svoje data.

Serverova cast sa preto nasadzuje ako oficialny self-hosted Supabase Docker Compose
stack. Nad nim sa aplikuje SQL schema projektu Nodify.

## Preco v repozitari nie je Dockerfile

Samostatny `Dockerfile` tu nie je potrebny, pretoze Supabase sa nespusta ako jeden
kontajner vytvoreny z kodu Nodify. Spusta sa ako viacero oficialnych kontajnerov cez
Docker Compose. Projekt Nodify dodava iba konfiguracnu/deploy vrstvu a databazovu
schemu.

Podrobnejsie vysvetlenie je v `infra/supabase/DOCKER.md`.

## Poziadavky na server

- Linux server s Docker Engine a Docker Compose pluginom.
- Verejna HTTPS adresa alebo reverzny proxy pred Supabase API.
- Perzistentny disk pre Postgres data.
- Pravidelne zalohy databazy.
- SMTP konfiguracia, ak bude zapnute potvrdzovanie emailov alebo obnova hesla.

Orientacne minimum pre plny Supabase stack je 4 GB RAM, 2 CPU jadra a SSD disk.

## Deploy postup

Na serveri naklonovat Nodify:

```bash
git clone https://github.com/Nikolai-Lazovatskii/nodify.git /srv/nodify/app
cd /srv/nodify/app
```

Stiahnut oficialny Supabase Docker stack do deploy adresara:

```bash
./infra/supabase/scripts/bootstrap-official-stack.sh /srv/nodify/supabase
```

Nastavit produkcne tajne hodnoty:

```bash
cd /srv/nodify/supabase
cp .env.example .env
nano .env
```

Pred spustenim je potrebne v `.env` zmenit vsetky placeholder hodnoty, hlavne hesla,
JWT/API kluce, verejne URL a Studio prihlasenie.

Spustit Supabase:

```bash
sh run.sh start
```

Aplikovat Nodify databazovu schemu:

```bash
cd /srv/nodify/app
./infra/supabase/scripts/apply-nodify-schema.sh /srv/nodify/supabase
```

Vypisat hodnoty pre mobilnu aplikaciu:

```bash
./infra/supabase/scripts/print-app-env.sh /srv/nodify/supabase
```

Vystup bude v tvare:

```env
EXPO_PUBLIC_SUPABASE_URL=https://supabase.example
EXPO_PUBLIC_SUPABASE_ANON_KEY=...
```

Tieto dve hodnoty sa pouziju v `.env` subore mobilnej aplikacie. Secret/service role
kluce sa do mobilnej aplikacie nikdy nedavaju.

## Pred odoslanim odkazu na repozitar

- V repozitari nema byt realny `.env` subor.
- V repozitari nema byt `SERVICE_ROLE_KEY`, `SUPABASE_SECRET_KEY`, databazove heslo
  ani JWT tajomstvo.
- V GitHub repozitari maju byt dostupne tieto subory:
  `infra/supabase/README.md`, `infra/supabase/DOCKER.md`,
  `docs/department-server-handoff.sk.md` a `supabase/migrations/001_initial_schema.sql`.
- Spravcovi servera staci poslat odkaz na repozitar a upozornit ho na tento dokument.

## Co treba overit po nasadeni

- Supabase kontajnery bezia a su healthy.
- Supabase API je dostupne cez HTTPS.
- Registracia a prihlasenie v aplikacii funguju.
- Nova mapa sa ulozi do `public.mind_maps`.
- Po odhlaseni a opatovnom prihlaseni sa mapa obnovi zo servera.
- Pouzivatel nevidi mapy ineho pouzivatela.

## Bezpecnostne poznamky

- Realne `.env` subory sa necommitnuju.
- `SERVICE_ROLE_KEY`, `SUPABASE_SECRET_KEY`, `POSTGRES_PASSWORD` a JWT tajomstva
  zostavaju iba na serveri.
- Verejny anon/publishable key moze byt v mobilnej aplikacii, pretoze pristup je
  obmedzeny cez Row Level Security.
- Pred verejnym pouzitim treba zapnut HTTPS a nastavit zalohy Postgres databazy.

## Dolezite subory v repozitari

- `infra/supabase/README.md` - hlavna dokumentacia deploymentu.
- `infra/supabase/DOCKER.md` - vysvetlenie Docker architektury.
- `infra/supabase/scripts/` - pomocne deploy skripty.
- `supabase/migrations/001_initial_schema.sql` - databazova schema pre Nodify.
- `docs/self-hosted-supabase.md` - technicke poznamky k self-hosted Supabase.
