import { Controller, Get, Inject, NotFoundException, Param, UseGuards } from '@nestjs/common';
import { and, asc, eq, inArray, ne, notInArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { JwtAuthGuard, Roles } from '../auth/guards';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { categories, jobOffers, jobs, proCategories, proProfiles, users } from '../db/schema';
import { distanceKmSql } from '../dispatch/geo';
import { DB, type Db } from '../infra/infra.module';

const LIMIT = 50;

/**
 * Staff: why a job does or doesn't reach Pros. For every Pro who offers the job's service,
 * shows each rule the matching applies (verified, active account, service area set,
 * within travel distance, not already asked; online for emergencies), so support can tell
 * a customer or Pro exactly what to fix. Also lists Pros who don't offer this service, in
 * case one picked a similar skill.
 */
@Controller('admin/jobs')
@UseGuards(JwtAuthGuard)
@Roles(['ADMIN', 'SUPER_ADMIN'])
export class AdminJobMatchingController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get(':id/matching')
  async matching(@Param('id', new ZodValidationPipe(z.uuid())) id: string) {
    const [job] = await this.db
      .select({
        id: jobs.id,
        type: jobs.type,
        status: jobs.status,
        description: jobs.description,
        categoryId: jobs.categoryId,
        serviceName: categories.name,
        latitude: jobs.latitude,
        longitude: jobs.longitude,
        scheduledAt: jobs.scheduledAt,
        createdAt: jobs.createdAt,
        customerId: jobs.customerId,
        customerName: users.name,
      })
      .from(jobs)
      .innerJoin(categories, eq(categories.id, jobs.categoryId))
      .innerJoin(users, eq(users.id, jobs.customerId))
      .where(eq(jobs.id, id))
      .limit(1);
    if (!job) throw new NotFoundException();

    const distance = distanceKmSql(
      proProfiles.latitude,
      proProfiles.longitude,
      job.latitude,
      job.longitude,
    );
    const rows = await this.db
      .select({
        id: users.id,
        name: users.name,
        accountStatus: users.status,
        verificationStatus: proProfiles.verificationStatus,
        isOnline: proProfiles.isOnline,
        serviceRadiusKm: proProfiles.serviceRadiusKm,
        hasServiceArea: sql<boolean>`${proProfiles.latitude} is not null`,
        distanceKm: sql<
          number | null
        >`case when ${proProfiles.latitude} is null then null else ${distance} end`,
        askedStatus: sql<string | null>`(
          select ${jobOffers.status} from ${jobOffers}
          where ${jobOffers.jobId} = ${job.id} and ${jobOffers.proId} = ${users.id}
          order by ${jobOffers.createdAt} desc limit 1)`,
      })
      .from(proCategories)
      .innerJoin(users, eq(users.id, proCategories.proId))
      .innerJoin(proProfiles, eq(proProfiles.userId, users.id))
      .where(and(eq(proCategories.categoryId, job.categoryId), eq(users.role, 'PRO')))
      // Nearest first; Pros who haven't set a service area last.
      .orderBy(sql`${proProfiles.latitude} is null`, asc(distance), asc(users.createdAt))
      .limit(LIMIT);

    const matchIds = rows.map((r) => r.id);
    const others = await this.db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(
        and(
          eq(users.role, 'PRO'),
          ne(users.id, job.customerId),
          matchIds.length ? notInArray(users.id, matchIds) : undefined,
        ),
      )
      .orderBy(asc(users.createdAt))
      .limit(20);
    const otherSkills = others.length
      ? await this.db
          .select({ proId: proCategories.proId, name: categories.name })
          .from(proCategories)
          .innerJoin(categories, eq(categories.id, proCategories.categoryId))
          .where(
            inArray(
              proCategories.proId,
              others.map((o) => o.id),
            ),
          )
          .orderBy(asc(categories.name))
      : [];

    return {
      job: {
        id: job.id,
        type: job.type,
        status: job.status,
        description: job.description,
        serviceName: job.serviceName,
        scheduledAt: job.scheduledAt,
        createdAt: job.createdAt,
        customerId: job.customerId,
        customerName: job.customerName,
      },
      pros: rows.map((r) => {
        const distanceKm =
          r.distanceKm === null ? null : Math.round(Number(r.distanceKm) * 10) / 10;
        const checks = {
          verified: r.verificationStatus === 'APPROVED',
          accountActive: r.accountStatus === 'ACTIVE',
          serviceAreaSet: r.hasServiceArea,
          withinDistance: distanceKm !== null && distanceKm <= r.serviceRadiusKm,
          notAskedYet: r.askedStatus === null,
          // Only emergencies need the Pro to be online right now.
          onlineIfEmergency: job.type !== 'EMERGENCY' || r.isOnline,
        };
        return {
          id: r.id,
          name: r.name,
          verificationStatus: r.verificationStatus,
          accountStatus: r.accountStatus,
          isOnline: r.isOnline,
          serviceRadiusKm: r.serviceRadiusKm,
          distanceKm,
          askedStatus: r.askedStatus,
          checks,
          matches: Object.values(checks).every(Boolean),
        };
      }),
      otherPros: others.map((o) => ({
        id: o.id,
        name: o.name,
        skills: otherSkills.filter((s) => s.proId === o.id).map((s) => s.name),
      })),
    };
  }
}
