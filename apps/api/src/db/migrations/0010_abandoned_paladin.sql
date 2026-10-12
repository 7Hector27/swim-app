CREATE TYPE "public"."skill_type" AS ENUM('rubric', 'measured', 'score', 'composite', 'rollup');--> statement-breakpoint
CREATE TYPE "public"."stroke" AS ENUM('free', 'back', 'breast', 'fly');--> statement-breakpoint
CREATE TABLE "rating_scale_levels" (
	"level" integer PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"meaning" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rating_level_1_to_5" CHECK ("rating_scale_levels"."level" >= 1 AND "rating_scale_levels"."level" <= 5)
);
--> statement-breakpoint
ALTER TABLE "rating_scale_levels" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "skill_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skill_categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "skill_categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "skill_dependencies" (
	"skill_id" uuid NOT NULL,
	"depends_on_skill_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skill_dependencies_skill_id_depends_on_skill_id_pk" PRIMARY KEY("skill_id","depends_on_skill_id"),
	CONSTRAINT "no_self_reference" CHECK ("skill_dependencies"."skill_id" <> "skill_dependencies"."depends_on_skill_id")
);
--> statement-breakpoint
ALTER TABLE "skill_dependencies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "skill_level_descriptors" (
	"skill_id" uuid NOT NULL,
	"level" integer NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skill_level_descriptors_skill_id_level_pk" PRIMARY KEY("skill_id","level"),
	CONSTRAINT "skill_level_1_to_5" CHECK ("skill_level_descriptors"."level" >= 1 AND "skill_level_descriptors"."level" <= 5)
);
--> statement-breakpoint
ALTER TABLE "skill_level_descriptors" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"category_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" "skill_type" NOT NULL,
	"unit" text,
	"stroke" "stroke",
	"applies_to" text[],
	"parent_skill_id" uuid,
	"sort_order" integer NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skills_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "skills" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "skill_dependencies" ADD CONSTRAINT "skill_dependencies_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_dependencies" ADD CONSTRAINT "skill_dependencies_depends_on_skill_id_skills_id_fk" FOREIGN KEY ("depends_on_skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_level_descriptors" ADD CONSTRAINT "skill_level_descriptors_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_category_id_skill_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."skill_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_parent_skill_id_skills_id_fk" FOREIGN KEY ("parent_skill_id") REFERENCES "public"."skills"("id") ON DELETE restrict ON UPDATE no action;