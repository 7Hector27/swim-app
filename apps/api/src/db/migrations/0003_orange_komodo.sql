CREATE TYPE "public"."sex" AS ENUM('female', 'male');--> statement-breakpoint
CREATE TABLE "clubs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clubs_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "clubs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "guardians" (
	"profile_id" uuid NOT NULL,
	"swimmer_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guardians_profile_id_swimmer_id_pk" PRIMARY KEY("profile_id","swimmer_id")
);
--> statement-breakpoint
ALTER TABLE "guardians" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "swimmer_clubs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"swimmer_id" uuid NOT NULL,
	"club_id" uuid,
	"other_club_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exactly_one_club" CHECK (("swimmer_clubs"."club_id" IS NOT NULL AND "swimmer_clubs"."other_club_name" IS NULL) OR ("swimmer_clubs"."club_id" IS NULL AND "swimmer_clubs"."other_club_name" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "swimmer_clubs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "swimmers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"birth_date" date NOT NULL,
	"sex" "sex" NOT NULL,
	"is_public" boolean NOT NULL,
	"public_consent_at" timestamp with time zone,
	"public_consent_by" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "public_consent_required" CHECK (NOT "swimmers"."is_public" OR ("swimmers"."public_consent_at" IS NOT NULL AND "swimmers"."public_consent_by" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "swimmers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "guardians" ADD CONSTRAINT "guardians_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardians" ADD CONSTRAINT "guardians_swimmer_id_swimmers_id_fk" FOREIGN KEY ("swimmer_id") REFERENCES "public"."swimmers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swimmer_clubs" ADD CONSTRAINT "swimmer_clubs_swimmer_id_swimmers_id_fk" FOREIGN KEY ("swimmer_id") REFERENCES "public"."swimmers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swimmer_clubs" ADD CONSTRAINT "swimmer_clubs_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swimmers" ADD CONSTRAINT "swimmers_public_consent_by_profiles_id_fk" FOREIGN KEY ("public_consent_by") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "swimmer_clubs_swimmer_club_uniq" ON "swimmer_clubs" USING btree ("swimmer_id","club_id") WHERE "swimmer_clubs"."club_id" IS NOT NULL;