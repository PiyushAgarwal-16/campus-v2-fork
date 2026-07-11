CREATE TYPE "public"."subscription_interval" AS ENUM('none', 'monthly', 'yearly');--> statement-breakpoint
CREATE TYPE "public"."subscription_source" AS ENUM('purchase', 'admin_grant', 'trial');--> statement-breakpoint
CREATE TYPE "public"."subscription_txn_status" AS ENUM('pending', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."subscription_txn_type" AS ENUM('payment', 'refund');--> statement-breakpoint
CREATE TYPE "public"."user_subscription_status" AS ENUM('active', 'cancelled', 'expired', 'granted');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "subscription_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"price_cents" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"interval" "subscription_interval" NOT NULL,
	"features" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_subscription_plans_code" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "subscription_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subscription_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"type" "subscription_txn_type" NOT NULL,
	"status" "subscription_txn_status" NOT NULL,
	"provider" text,
	"provider_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_subscription_txn_provider_ref" UNIQUE("provider","provider_ref")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"status" "user_subscription_status" NOT NULL,
	"source" "subscription_source" NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"current_period_end" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "subscription_transactions" ADD CONSTRAINT "subscription_transactions_subscription_id_user_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."user_subscriptions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_subscriptions" ADD CONSTRAINT "user_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_subscriptions" ADD CONSTRAINT "user_subscriptions_plan_id_subscription_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."subscription_plans"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_subscription_txn_subscription" ON "subscription_transactions" USING btree ("subscription_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_user_subscriptions_active" ON "user_subscriptions" USING btree ("user_id") WHERE status in ('active','granted');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_user_subscriptions_period_end" ON "user_subscriptions" USING btree ("current_period_end");