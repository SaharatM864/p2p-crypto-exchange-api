import { PrismaClient, CurrencyType } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting seed...');

  // 1. Seed Currencies
  const currencies = [
    {
      code: 'BTC',
      name: 'Bitcoin',
      type: CurrencyType.CRYPTO,
      decimalPlaces: 8,
    },
    {
      code: 'ETH',
      name: 'Ethereum',
      type: CurrencyType.CRYPTO,
      decimalPlaces: 18,
    },
    {
      code: 'USDT',
      name: 'Tether',
      type: CurrencyType.CRYPTO,
      decimalPlaces: 6,
    },
    {
      code: 'THB',
      name: 'Thai Baht',
      type: CurrencyType.FIAT,
      decimalPlaces: 2,
    },
    {
      code: 'USD',
      name: 'US Dollar',
      type: CurrencyType.FIAT,
      decimalPlaces: 2,
    },
  ];

  console.log('🪙  Seeding currencies...');
  for (const currency of currencies) {
    const upserted = await prisma.currency.upsert({
      where: { code: currency.code },
      update: {},
      create: currency,
    });
    console.log(`  - Upserted currency: ${upserted.code}`);
  }

  // 2. Seed Test Users (Optional - for development)
  if (process.env.NODE_ENV === 'development') {
    console.log('👤 Seeding test users...');

    // Admin / System User maybe?
    // For now just basic users
  }

  console.log('✅ Seed completed successfully.');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
