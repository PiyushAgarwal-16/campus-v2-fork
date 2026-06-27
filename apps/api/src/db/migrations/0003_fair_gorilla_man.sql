CREATE TYPE "public"."message_context_type" AS ENUM('anon_session', 'friendship');--> statement-breakpoint
CREATE TYPE "public"."message_delivery_status" AS ENUM('sent', 'delivered', 'read');--> statement-breakpoint
CREATE TYPE "public"."message_type" AS ENUM('text', 'voice', 'image', 'system');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "message_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"context_type" "message_context_type" NOT NULL,
	"session_id" uuid,
	"friendship_id" uuid,
	"last_read_message_id" uuid,
	"last_read_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_message_receipts_conversation" UNIQUE("user_id","context_type","session_id","friendship_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "messages" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"context_type" "message_context_type" NOT NULL,
	"session_id" uuid,
	"friendship_id" uuid,
	"sender_id" uuid NOT NULL,
	"type" "message_type" DEFAULT 'text' NOT NULL,
	"body" text,
	"has_attachment" boolean DEFAULT false NOT NULL,
	"delivery_status" "message_delivery_status" DEFAULT 'sent' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "messages_created_at_id_pk" PRIMARY KEY("created_at","id"),
	CONSTRAINT "messages_one_context" CHECK ((context_type = 'anon_session' and session_id is not null and friendship_id is null)
          or (context_type = 'friendship' and friendship_id is not null and session_id is null))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "message_receipts" ADD CONSTRAINT "message_receipts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "message_receipts" ADD CONSTRAINT "message_receipts_session_id_anon_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."anon_sessions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "messages" ADD CONSTRAINT "messages_session_id_anon_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."anon_sessions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_messages_session_created" ON "messages" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_messages_friendship_created" ON "messages" USING btree ("friendship_id","created_at");