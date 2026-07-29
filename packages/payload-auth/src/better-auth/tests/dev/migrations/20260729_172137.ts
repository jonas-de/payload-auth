import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "admin_invitations" ADD COLUMN "expires_at" timestamp(3) with time zone;
   UPDATE "admin_invitations" SET "expires_at" = now() WHERE "expires_at" IS NULL;
   ALTER TABLE "admin_invitations" ALTER COLUMN "expires_at" SET NOT NULL;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "admin_invitations" DROP COLUMN "expires_at";`)
}
