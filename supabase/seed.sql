-- Development-only seed, applied by `npx supabase db reset` on the LOCAL stack.
-- Never run this against a production database.
--
-- Users can't be seeded safely here (they must be created through Auth so passwords are hashed
-- and the signup trigger runs). Register in the app instead: the first account becomes the
-- administrator automatically.

-- Open registration locally so test accounts can sign up without invitation codes.
update public.app_settings set registration_mode = 'open' where id;
