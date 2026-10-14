ALTER TABLE "skills" DROP COLUMN "side";
DROP TYPE "public"."skill_side";
ALTER TABLE "skills" ADD COLUMN "rated_per_side" boolean DEFAULT false NOT NULL;