# Supabase Deployment Notes

This directory documents the server-side deployment target for Nodify. The recommended deployment is the official self-hosted Supabase Docker stack running on the department server.

## Recommended Flow

1. On the server, clone the official Supabase repository or copy the official Docker self-hosting setup.
2. Configure the Supabase `.env` values. Use `infra/supabase/.env.example` as a checklist, not as a complete production config.
3. Start the Supabase Docker stack.
4. Apply the Nodify schema migration from the repository root:

```bash
psql "$DATABASE_URL" -f supabase/migrations/001_initial_schema.sql
```

5. In the mobile app environment, set:

```env
EXPO_PUBLIC_SUPABASE_URL=https://your-supabase-host.example
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

## Required Tables

- `public.profiles`
- `public.mind_maps`

The full schema is in `supabase/migrations/001_initial_schema.sql`.

## What to Ask the Department Admin For

- Linux host with Docker and Docker Compose.
- Public HTTPS URL or reverse proxy path.
- Persistent Postgres volume.
- Regular database backups.
- SMTP settings for account confirmation and password recovery, if email confirmation is enabled.

## Production Checklist

- Change all generated secrets from examples.
- Keep `SERVICE_ROLE_KEY` server-only.
- Enable HTTPS before using the mobile client outside local testing.
- Test register, login, map creation, map sync, and soft delete.
