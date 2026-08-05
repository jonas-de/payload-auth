import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "two_factors" ADD COLUMN "verified" boolean;
  ALTER TABLE "two_factors" ADD COLUMN "failed_verification_count" numeric;
  ALTER TABLE "two_factors" ADD COLUMN "locked_until" timestamp(3) with time zone;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "two_factors" DROP COLUMN "verified";
  ALTER TABLE "two_factors" DROP COLUMN "failed_verification_count";
  ALTER TABLE "two_factors" DROP COLUMN "locked_until";`)
}
