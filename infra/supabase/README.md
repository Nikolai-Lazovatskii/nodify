# Self-hosted Supabase Server Deployment

This directory contains the deployment wrapper for the server-side part of Nodify.
The runtime is the official self-hosted Supabase Docker stack; this repository adds
Nodify-specific schema migration and operational notes.

The full official Docker Compose files are not vendored here because Supabase updates
them separately. Use the scripts in `infra/supabase/scripts/` to fetch the official
stack and then apply the Nodify schema.

Official reference: https://supabase.com/docs/guides/self-hosting/docker

For a short Slovak handoff document for the department administrator, see
`docs/department-server-handoff.sk.md`.

For the Dockerfile/Docker Compose explanation, see `infra/supabase/DOCKER.md`.

## Server Requirements

- Linux host with Docker and Docker Compose plugin.
- Public HTTPS URL or a reverse proxy path for the Supabase API.
- Persistent disk for the Postgres volume.
- Regular database backups.
- SMTP settings if email confirmation or password recovery is enabled.

## Quick Deployment

Clone Nodify on the server:

```bash
git clone https://github.com/Nikolai-Lazovatskii/nodify.git /srv/nodify/app
cd /srv/nodify/app
```

Fetch the official Supabase Docker stack into a deploy directory:

```bash
./infra/supabase/scripts/bootstrap-official-stack.sh /srv/nodify/supabase
```

Configure Supabase secrets:

```bash
cd /srv/nodify/supabase
cp .env.example .env
nano .env
```

Start the Supabase stack:

```bash
sh run.sh start
```

Apply the Nodify database schema from the app repository:

```bash
cd /srv/nodify/app
./infra/supabase/scripts/apply-nodify-schema.sh /srv/nodify/supabase
```

Print the Expo client environment values:

```bash
./infra/supabase/scripts/print-app-env.sh /srv/nodify/supabase
```

The output should be copied into the mobile app `.env`:

```env
EXPO_PUBLIC_SUPABASE_URL=https://your-supabase-host.example
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

## Environment Notes

Use `infra/supabase/.env.example` as a short checklist for important variables, not
as a full replacement for the official Supabase `.env.example`.

Never commit generated `.env` files, database passwords, JWT secrets, secret keys,
or service role keys. Only the public anon/publishable key belongs in the Expo app.

## Required Tables

- `public.profiles`
- `public.mind_maps`

The full schema is in `supabase/migrations/001_initial_schema.sql`.

## Script Reference

- `bootstrap-official-stack.sh [deploy-dir]` - copies the official Supabase Docker
  stack into the deployment directory.
- `apply-nodify-schema.sh [deploy-dir] [migration-file]` - applies the Nodify SQL
  schema inside the running Supabase Postgres container.
- `print-app-env.sh [deploy-dir]` - prints the two `EXPO_PUBLIC_SUPABASE_*`
  variables needed by the mobile app.

## Production Checklist

- Change all generated secrets from examples.
- Keep `SERVICE_ROLE_KEY` and `SUPABASE_SECRET_KEY` server-only.
- Put the Supabase API behind HTTPS before using the mobile client outside local testing.
- Back up the Postgres volume/database regularly.
- Test register, login, map creation, map sync, and soft delete.

## Updating Supabase

For server updates, follow the official self-hosting update instructions for the
Supabase Docker stack, then run:

```bash
cd /srv/nodify/app
./infra/supabase/scripts/apply-nodify-schema.sh /srv/nodify/supabase
```

The migration is written to be idempotent, so re-running it is safe.
