ALTER TABLE "users" ADD COLUMN "anon_handle" text;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "uq_users_anon_handle" UNIQUE("anon_handle");