# Self-hosted Supabase for Nodify

Nodify can use a self-hosted Supabase instance instead of Supabase Cloud. The mobile app still uses the Supabase client SDK, but the URL and anon key point to the department server.

## Used Supabase Services

- Auth: email/password accounts and sessions.
- Postgres + PostgREST: `profiles` and `mind_maps` tables.
- Row Level Security: users can only read and write their own rows.

Nodify currently does not require Supabase Storage, Realtime, Edge Functions, or Vector.

## Database Schema

Apply the migration:

```bash
supabase/migrations/001_initial_schema.sql
```

It creates:

- `public.profiles`
- `public.mind_maps`
- RLS policies for authenticated users
- indexes used by map listing and sync

The client expects `mind_maps` to support an upsert conflict target on `(user_id, id)`.

## Mobile App Environment

After the department Supabase instance is deployed, configure the app with:

```env
EXPO_PUBLIC_SUPABASE_URL=https://your-self-hosted-supabase.example
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

The real `.env` file is local-only and must not be committed. Use `.env.example` as the template.

## Deployment Outline

1. Deploy self-hosted Supabase on the department server using Docker.
2. Configure public URL, JWT secret, anon key, service role key, database password, and SMTP.
3. Apply `supabase/migrations/001_initial_schema.sql`.
4. Create a test user through the app or Supabase Studio.
5. Verify:
   - login/register works;
   - a map can be created;
   - a map appears in `public.mind_maps`;
   - logout/login restores the map from the server.

## Migration from Supabase Cloud

For a first production move, export data from the existing Supabase Cloud project and import it into the self-hosted Postgres database. At minimum, migrate:

- users from `auth.users` if existing accounts must remain valid;
- rows from `public.profiles`;
- rows from `public.mind_maps`.

If user migration is not required, users can register again on the new instance and maps can be imported/exported through Nodify.

## Operational Notes

- Put the Supabase API behind HTTPS.
- Keep service role keys only on the server.
- Back up the Postgres volume/database regularly.
- Monitor disk usage because map documents and attachments can make `doc jsonb` rows grow.
- Rotate keys if an environment file was ever committed or shared.
