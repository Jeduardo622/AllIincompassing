-- @migration-intent: Remove legacy app.get_user_roles helper to avoid schema ambiguity after public.get_user_roles adoption.
-- @migration-dependencies: 20250319153129_gentle_meadow.sql,20250319163544_flat_spring.sql
-- @migration-rollback: Recreate app.get_user_roles from 20250318172727_rough_star.sql if any consumer requires it.

DROP FUNCTION IF EXISTS app.get_user_roles();
