# Docker Architecture

Nodify does not need a custom application server image at the moment. The mobile
client talks directly to Supabase APIs, and the server-side runtime is the official
self-hosted Supabase Docker Compose stack.

## Why There Is No Dockerfile

Supabase is not deployed as one custom container. It is a multi-container stack
made of official images, for example:

- Postgres
- Auth
- PostgREST
- API gateway
- Studio
- supporting services configured by the official Supabase stack

Because of that, the deployment entry point is Docker Compose, not a project-local
`Dockerfile`.

## What This Repository Adds

This repository adds the Nodify-specific layer on top of the official Supabase
stack:

- `supabase/migrations/001_initial_schema.sql` - database schema and RLS policies.
- `infra/supabase/scripts/bootstrap-official-stack.sh` - fetches the official
  Supabase Docker setup into a deployment directory.
- `infra/supabase/scripts/apply-nodify-schema.sh` - applies the Nodify schema to
  the running Supabase Postgres container.
- `infra/supabase/scripts/print-app-env.sh` - prints the Expo client environment
  values after the server is configured.

## When a Dockerfile Would Be Needed

A custom `Dockerfile` would make sense only if Nodify later adds its own backend
service, for example:

- a custom API outside Supabase;
- background jobs;
- server-side import/export processing;
- file conversion workers;
- custom push notification service.

For the current architecture, Docker Compose plus the Nodify SQL migration is the
correct server deployment model.
