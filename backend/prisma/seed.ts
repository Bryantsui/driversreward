import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // Create super admin (you)
  const adminPassword = await bcrypt.hash('AdminPass123!@#', 12);
  const admin = await prisma.admin.upsert({
    where: { email: 'admin@driversbonus.com' },
    update: {},
    create: {
      email: 'admin@driversbonus.com',
      passwordHash: adminPassword,
      name: 'Bryan (Super Admin)',
      role: 'SUPER_ADMIN',
    },
  });
  console.log(`Admin created: ${admin.email} (${admin.role})`);

  // Seed gift cards for HK
  const hkGiftCards = [
    { name: 'HKTVmall eVoucher HK$50', provider: 'HKTVmall', pointsCost: 500, faceValue: 50, currency: 'HKD', stockCount: 100 },
    { name: 'HKTVmall eVoucher HK$100', provider: 'HKTVmall', pointsCost: 950, faceValue: 100, currency: 'HKD', stockCount: 50 },
    { name: 'Shell Petrol Voucher HK$100', provider: 'Shell', pointsCost: 1000, faceValue: 100, currency: 'HKD', stockCount: 50 },
    { name: 'McDonald\'s Coupon HK$25', provider: 'McDonald\'s', pointsCost: 250, faceValue: 25, currency: 'HKD', stockCount: 200 },
    { name: 'PARKnSHOP eVoucher HK$50', provider: 'PARKnSHOP', pointsCost: 500, faceValue: 50, currency: 'HKD', stockCount: 100 },
    { name: 'Starbucks HK$50', provider: 'Starbucks', pointsCost: 500, faceValue: 50, currency: 'HKD', stockCount: 80 },
  ];

  for (const gc of hkGiftCards) {
    await prisma.giftCard.upsert({
      where: { id: gc.name }, // will fail on first run, that's fine
      update: { stockCount: gc.stockCount },
      create: { ...gc, region: 'HK' },
    }).catch(() =>
      prisma.giftCard.create({ data: { ...gc, region: 'HK' } })
    );
  }
  console.log(`Seeded ${hkGiftCards.length} HK gift cards`);

  // Seed gift cards for BR
  const brGiftCards = [
    { name: 'iFood Voucher R$25', provider: 'iFood', pointsCost: 250, faceValue: 25, currency: 'BRL', stockCount: 200 },
    { name: 'iFood Voucher R$50', provider: 'iFood', pointsCost: 475, faceValue: 50, currency: 'BRL', stockCount: 100 },
    { name: 'Shell Combustível R$50', provider: 'Shell', pointsCost: 500, faceValue: 50, currency: 'BRL', stockCount: 100 },
    { name: 'Amazon.com.br R$50', provider: 'Amazon', pointsCost: 500, faceValue: 50, currency: 'BRL', stockCount: 80 },
    { name: 'Magazine Luiza R$100', provider: 'Magalu', pointsCost: 950, faceValue: 100, currency: 'BRL', stockCount: 50 },
    { name: 'Mercado Livre R$50', provider: 'MercadoLivre', pointsCost: 500, faceValue: 50, currency: 'BRL', stockCount: 80 },
  ];

  for (const gc of brGiftCards) {
    await prisma.giftCard.create({ data: { ...gc, region: 'BR' } }).catch(() => {});
  }
  console.log(`Seeded ${brGiftCards.length} BR gift cards`);

  console.log('Seed complete!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
