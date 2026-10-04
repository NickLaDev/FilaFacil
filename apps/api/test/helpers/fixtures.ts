import { ROLE_DEFAULT_PERMISSIONS, type PlanFeature, type UserRole } from '@filafacil/shared';
import type { PrismaService } from '../../src/database/prisma.service.js';
import { PasswordHasher } from '../../src/modules/auth/password-hasher.service.js';
import { CSRF, type Agent } from './test-app.js';

export const PASSWORD = 'Senha123';
export const VALID_CPF = '52998224725';
export const OTHER_VALID_CPF = '11144477735';

const CAMPINAS = { latitude: -22.9056, longitude: -47.0608 };
const ALL_FEATURES: PlanFeature[] = ['floor_plan', 'waitlist', 'promotions', 'recipes', 'layout_duplication'];

let passwordHash: string | null = null;

async function createUser(prisma: PrismaService, data: { name: string; email: string; role: UserRole; establishmentIds?: string[]; phone?: string }) {
  passwordHash ??= await new PasswordHasher().hash(PASSWORD);
  return prisma.user.create({
    data: {
      name: data.name,
      email: data.email,
      phone: data.phone,
      role: data.role,
      passwordHash,
      permissions: { create: ROLE_DEFAULT_PERMISSIONS[data.role].map(permission => ({ permission })) },
      memberships: { create: (data.establishmentIds ?? []).map(establishmentId => ({ establishmentId })) },
    },
  });
}

/** Mundo mínimo: dois estabelecimentos "Business", um "Start", equipe de cada um, admin e cliente. */
export async function createWorld(prisma: PrismaService) {
  const business = await prisma.plan.create({
    data: { name: 'Business', monthlyPriceCents: 79900, maxUnits: 999, maxTables: 999, maxStaff: 999, features: { create: ALL_FEATURES.map(feature => ({ feature })) } },
  });
  const start = await prisma.plan.create({
    data: { name: 'Start', monthlyPriceCents: 9900, maxUnits: 1, maxTables: 3, maxStaff: 5, features: { create: [{ feature: 'floor_plan' }, { feature: 'waitlist' }] } },
  });
  const organization = await prisma.organization.create({ data: { name: 'Grupo Teste' } });
  const allDay = Array.from({ length: 7 }, (_, weekday) => ({ weekday, opensAt: 0, closesAt: 1440 }));
  const establishment = (name: string, planId: string, offset: number) =>
    prisma.establishment.create({
      data: {
        name,
        type: 'bar',
        city: 'Campinas',
        address: `Rua ${name}, 1`,
        latitude: CAMPINAS.latitude + offset,
        longitude: CAMPINAS.longitude,
        organizationId: organization.id,
        planId,
        openingHours: { create: allDay },
      },
    });
  const estA = await establishment('Bar A', business.id, 0.001);
  const estB = await establishment('Bar B', business.id, 0.002);
  const estStart = await establishment('Bar Start', start.id, 0.003);

  const category = async (establishmentId: string, name: string) => prisma.menuCategory.create({ data: { establishmentId, name, position: 1 } });
  const catA = await category(estA.id, 'Cervejas');
  const catB = await category(estB.id, 'Cervejas');
  const itemA = await prisma.menuItem.create({ data: { establishmentId: estA.id, categoryId: catA.id, name: 'IPA', priceCents: 2000, position: 1 } });
  const itemB = await prisma.menuItem.create({ data: { establishmentId: estB.id, categoryId: catB.id, name: 'Pilsen', priceCents: 1000, position: 1 } });

  const admin = await createUser(prisma, { name: 'Admin', email: 'admin@test.dev', role: 'admin' });
  const secondAdmin = await createUser(prisma, { name: 'Admin 2', email: 'admin2@test.dev', role: 'admin' });
  const managerA = await createUser(prisma, { name: 'Gestor A', email: 'gestor.a@test.dev', role: 'manager', establishmentIds: [estA.id] });
  const managerB = await createUser(prisma, { name: 'Gestor B', email: 'gestor.b@test.dev', role: 'manager', establishmentIds: [estB.id] });
  const managerStart = await createUser(prisma, { name: 'Gestor Start', email: 'gestor.start@test.dev', role: 'manager', establishmentIds: [estStart.id] });
  const attendantA = await createUser(prisma, { name: 'Atendente A', email: 'atendente.a@test.dev', role: 'attendant', establishmentIds: [estA.id] });
  const client = await createUser(prisma, { name: 'Cliente', email: 'cliente@test.dev', role: 'client', phone: '19999990000' });

  return { plans: { business, start }, organization, estA, estB, estStart, itemA, itemB, admin, secondAdmin, managerA, managerB, managerStart, attendantA, client };
}

export type World = Awaited<ReturnType<typeof createWorld>>;

export async function login(agent: Agent, email: string | null, password = PASSWORD) {
  if (!email) throw new Error('Usuário de teste sem e-mail.');
  const response = await agent.post('/api/auth/login').set(CSRF).send({ email, password });
  if (response.status !== 200) throw new Error(`Login falhou para ${email}: ${response.status} ${JSON.stringify(response.body)}`);
  return agent;
}
