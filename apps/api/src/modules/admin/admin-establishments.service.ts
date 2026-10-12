import { Injectable } from '@nestjs/common';
import type { AdminEstablishmentDto, AdminEstablishmentsPage, EstablishmentStatus, OrganizationDto } from '@filafacil/shared';
import { badRequest, conflict, notFound, unprocessable } from '../../common/http/app-error.js';
import { pageArgs } from '../../common/pagination/page-query.dto.js';
import { isValidTimeZone, parseTime, toOpeningHourDto } from '../../common/time/opening-hours.js';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { ImageUploadService, type UploadedImage } from '../storage/image-upload.service.js';
import type {
  CreateEstablishmentDto,
  ListEstablishmentsQueryDto,
  OpeningHourInputDto,
  UpdateEstablishmentDto,
} from './dto/admin-establishments.dto.js';

const MAX_PHOTOS = 10;
const DEFAULT_TIMEZONE = 'America/Sao_Paulo';

const ADMIN_INCLUDE = {
  organization: { select: { id: true, name: true } },
  plan: { select: { id: true, name: true } },
  openingHours: { orderBy: [{ weekday: 'asc' }, { opensAt: 'asc' }], select: { weekday: true, opensAt: true, closesAt: true } },
  photos: { orderBy: { position: 'asc' }, select: { id: true, url: true } },
  memberships: { where: { user: { role: 'manager' } }, select: { user: { select: { name: true } } } },
} satisfies Prisma.EstablishmentInclude;

type AdminRow = Prisma.EstablishmentGetPayload<{ include: typeof ADMIN_INCLUDE }>;

const toAdminDto = (row: AdminRow): AdminEstablishmentDto => ({
  id: row.id,
  name: row.name,
  type: row.type,
  status: row.status,
  city: row.city,
  address: row.address,
  latitude: row.latitude,
  longitude: row.longitude,
  timezone: row.timezone,
  organization: row.organization,
  plan: row.plan,
  foodCategories: row.foodCategories,
  tags: row.tags,
  averageWaitMinutes: row.averageWaitMinutes,
  pickupPoint: row.pickupPoint,
  ordersPaused: row.ordersPaused,
  highDemand: row.highDemand,
  rating: row.ratingAverage.toNumber(),
  ratingCount: row.ratingCount,
  openingHours: row.openingHours.map(toOpeningHourDto),
  photos: row.photos,
  managerNames: row.memberships.map(membership => membership.user.name),
  createdAt: row.createdAt.toISOString(),
});

const toRanges = (hours: OpeningHourInputDto[]) =>
  hours.map(hour => ({ weekday: hour.weekday, opensAt: parseTime(hour.opensAt), closesAt: Math.min(parseTime(hour.closesAt), 1440) }));

/** Ficha 34: cadastro, edição, vínculo com organização e status dos estabelecimentos parceiros. */
@Injectable()
export class AdminEstablishmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly images: ImageUploadService,
  ) {}

  async list(query: ListEstablishmentsQueryDto): Promise<AdminEstablishmentsPage> {
    const search: Prisma.EstablishmentWhereInput = query.q
      ? { OR: [{ name: { contains: query.q, mode: 'insensitive' } }, { city: { contains: query.q, mode: 'insensitive' } }] }
      : {};
    const where: Prisma.EstablishmentWhereInput = { ...search, ...(query.status && { status: query.status }) };
    const [rows, total, grouped] = await this.prisma.$transaction([
      this.prisma.establishment.findMany({ where, include: ADMIN_INCLUDE, orderBy: { name: 'asc' }, ...pageArgs(query) }),
      this.prisma.establishment.count({ where }),
      this.prisma.establishment.groupBy({ by: ['status'], where: search, _count: { _all: true }, orderBy: { status: 'asc' } }),
    ]);
    const counts = { all: 0, active: 0, inactive: 0, suspended: 0 };
    for (const group of grouped) {
      const count = (group._count as { _all: number })._all;
      counts[group.status] = count;
      counts.all += count;
    }
    return { items: rows.map(toAdminDto), page: query.page, pageSize: query.pageSize, total, counts };
  }

  async get(id: string): Promise<AdminEstablishmentDto> {
    const row = await this.prisma.establishment.findUnique({ where: { id }, include: ADMIN_INCLUDE });
    if (!row) throw notFound('Estabelecimento não encontrado.');
    return toAdminDto(row);
  }

  async create(dto: CreateEstablishmentDto): Promise<AdminEstablishmentDto> {
    await this.assertReferences(dto.organizationId, dto.planId);
    const timezone = this.validTimezone(dto.timezone);
    const row = await this.prisma.establishment.create({
      data: {
        name: dto.name,
        type: dto.type,
        city: dto.city,
        address: dto.address,
        latitude: dto.latitude,
        longitude: dto.longitude,
        timezone,
        organizationId: dto.organizationId,
        planId: dto.planId,
        status: dto.status ?? 'active',
        foodCategories: dto.foodCategories ?? [],
        tags: dto.tags ?? [],
        averageWaitMinutes: dto.averageWaitMinutes ?? 15,
        ...(dto.pickupPoint !== undefined && { pickupPoint: dto.pickupPoint }),
        ordersPaused: dto.ordersPaused ?? false,
        highDemand: dto.highDemand ?? false,
        openingHours: { create: toRanges(dto.openingHours ?? []) },
      },
      include: ADMIN_INCLUDE,
    });
    this.realtime.restaurantUpdated(row.id);
    return toAdminDto(row);
  }

  /** Mudanças de plano/status valem na hora para a equipe e para o cliente (eventos em tempo real). */
  async update(id: string, dto: UpdateEstablishmentDto): Promise<AdminEstablishmentDto> {
    await this.get(id);
    await this.assertReferences(dto.organizationId, dto.planId);
    const row = await this.prisma.$transaction(async tx => {
      if (dto.openingHours) {
        await tx.openingHour.deleteMany({ where: { establishmentId: id } });
        await tx.openingHour.createMany({ data: toRanges(dto.openingHours).map(range => ({ ...range, establishmentId: id })) });
      }
      return tx.establishment.update({
        where: { id },
        data: {
          name: dto.name,
          type: dto.type,
          city: dto.city,
          address: dto.address,
          latitude: dto.latitude,
          longitude: dto.longitude,
          ...(dto.timezone !== undefined && { timezone: this.validTimezone(dto.timezone) }),
          organizationId: dto.organizationId,
          planId: dto.planId,
          status: dto.status,
          foodCategories: dto.foodCategories,
          tags: dto.tags,
          averageWaitMinutes: dto.averageWaitMinutes,
          pickupPoint: dto.pickupPoint,
          ordersPaused: dto.ordersPaused,
          highDemand: dto.highDemand,
        },
        include: ADMIN_INCLUDE,
      });
    });
    this.realtime.establishmentUpdated(id);
    return toAdminDto(row);
  }

  /** Inativo ou suspenso some da busca e da página do cliente imediatamente. */
  async setStatus(id: string, status: EstablishmentStatus): Promise<AdminEstablishmentDto> {
    await this.get(id);
    const row = await this.prisma.establishment.update({ where: { id }, data: { status }, include: ADMIN_INCLUDE });
    this.realtime.establishmentUpdated(id);
    return toAdminDto(row);
  }

  /** Ficha 37: migrar de plano libera/bloqueia recursos na hora (os guards leem o plano a cada requisição). */
  async setPlan(id: string, planId: string): Promise<AdminEstablishmentDto> {
    await this.get(id);
    await this.assertReferences(undefined, planId);
    const row = await this.prisma.establishment.update({ where: { id }, data: { planId }, include: ADMIN_INCLUDE });
    this.realtime.establishmentUpdated(id);
    return toAdminDto(row);
  }

  async addPhoto(id: string, file: UploadedImage | undefined): Promise<AdminEstablishmentDto> {
    await this.get(id);
    const count = await this.prisma.establishmentPhoto.count({ where: { establishmentId: id } });
    if (count >= MAX_PHOTOS) throw unprocessable('PHOTO_LIMIT', `Cada estabelecimento pode ter até ${MAX_PHOTOS} fotos.`);
    const stored = await this.images.store(file);
    await this.prisma.establishmentPhoto.create({ data: { establishmentId: id, url: stored.url, storageKey: stored.key, position: count + 1 } });
    this.realtime.restaurantUpdated(id);
    return this.get(id);
  }

  async removePhoto(id: string, photoId: string): Promise<AdminEstablishmentDto> {
    const photo = await this.prisma.establishmentPhoto.findFirst({ where: { id: photoId, establishmentId: id } });
    if (!photo) throw notFound('Foto não encontrada.');
    await this.prisma.establishmentPhoto.delete({ where: { id: photoId } });
    await this.images.discard(photo.storageKey);
    this.realtime.restaurantUpdated(id);
    return this.get(id);
  }

  listOrganizations(): Promise<OrganizationDto[]> {
    return this.prisma.organization.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } });
  }

  async createOrganization(name: string): Promise<OrganizationDto> {
    try {
      return await this.prisma.organization.create({ data: { name }, select: { id: true, name: true } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw conflict('ORGANIZATION_EXISTS', 'Já existe uma organização com esse nome.');
      }
      throw error;
    }
  }

  private validTimezone(timezone: string | undefined) {
    const value = timezone || DEFAULT_TIMEZONE;
    if (!isValidTimeZone(value)) throw badRequest('VALIDATION_FAILED', 'Dados inválidos.', [{ field: 'timezone', message: 'Fuso horário inválido.' }]);
    return value;
  }

  private async assertReferences(organizationId: string | undefined, planId: string | undefined) {
    const [organization, plan] = await Promise.all([
      organizationId ? this.prisma.organization.count({ where: { id: organizationId } }) : 1,
      planId ? this.prisma.plan.count({ where: { id: planId } }) : 1,
    ]);
    const details = [
      ...(organization ? [] : [{ field: 'organizationId', message: 'Organização não encontrada.' }]),
      ...(plan ? [] : [{ field: 'planId', message: 'Plano não encontrado.' }]),
    ];
    if (details.length) throw unprocessable('INVALID_REFERENCE', 'Organização ou plano inexistente.', details);
  }
}
