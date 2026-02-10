import {
  PrismaClient,
  CurrencyType,
  TransactionType,
  TransactionStatus,
  EntryType,
  UserStatus,
} from '@prisma/client';
import * as argon2 from 'argon2';
import { faker } from '@faker-js/faker';

const prisma = new PrismaClient();

// ----------------------------------------------------------------------
// 🛠️ UTILITIES & CONFIGURATION
// ----------------------------------------------------------------------

// รหัสผ่านกลางที่ Hash ไว้ล่วงหน้า (Performance Optimization)
// ไม่ต้อง Re-hash ทุกครั้งที่สร้าง User ใหม่ ประหยัดเวลาได้มหาศาล
let SHARED_PASSWORD_HASH: string;

async function prepareSharedPassword() {
  console.log('🔐 กำลังเตรียม Hash รหัสผ่านกลาง...');
  SHARED_PASSWORD_HASH = await argon2.hash('password123');
}

// ฟังก์ชันล้างข้อมูลเก่าตามลำดับ Dependency (ป้องกัน Error FK Constraint)
async function cleanDatabase() {
  console.log('🧹 กำลังล้างฐานข้อมูล (Cleaning Database)...');
  await prisma.ledgerEntry.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.externalTransfer.deleteMany();
  await prisma.trade.deleteMany();
  await prisma.order.deleteMany();
  await prisma.wallet.deleteMany();
  await prisma.user.deleteMany();
  await prisma.currency.deleteMany();
  console.log('✨ ล้างฐานข้อมูลเสร็จสิ้น');
}

// ----------------------------------------------------------------------
// 🏛️ TIER 0: REFERENCE DATA (ข้อมูลอ้างอิงคงที่)
// ----------------------------------------------------------------------

async function seedCurrencies() {
  console.log('🪙  กำลังสร้างข้อมูลสกุลเงิน (Currencies)...');

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
      name: 'Tether (USDT)',
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

  for (const currency of currencies) {
    await prisma.currency.upsert({
      where: { code: currency.code },
      update: {},
      create: currency,
    });
  }
}

// ----------------------------------------------------------------------
// 💰 LOGIC: DOUBLE-ENTRY LEDGER (ระบบบัญชีคู่)
// ----------------------------------------------------------------------

// ฟังก์ชันฝากเงินเข้าระบบที่ถูกต้องตามหลักบัญชี
// 1. สร้าง Transaction (Pre-Posting)
// 2. สร้าง Ledger Entry (บันทึกการเคลื่อนไหว)
// 3. อัปเดต Wallet Balance (ผลลัพธ์ปลายทาง)
async function depositFunds(
  userId: string,
  currencyCode: string,
  amount: number,
) {
  const amountDecimal = amount.toFixed(8); // แปลงเป็น String เพื่อความแม่นยำของ Decimal

  // 1. หา Wallet ของ User
  const wallet = await prisma.wallet.findUnique({
    where: { userId_currencyCode: { userId, currencyCode } },
  });

  if (!wallet)
    throw new Error(
      `Wallet not found for user ${userId} currency ${currencyCode}`,
    );

  // 2. สร้าง Transaction หลัก
  const transaction = await prisma.transaction.create({
    data: {
      type: TransactionType.DEPOSIT,
      status: TransactionStatus.POSTED, // รายการสำเร็จแล้ว
      description: 'Initial Seed Deposit',
      metadata: { source: 'seed-script' },
    },
  });

  // 3. สร้าง Ledger Entry (ขา Credit เข้ากระเป๋า)
  // คำนวณยอดเงินใหม่
  const newBalance = Number(wallet.availableBalance) + amount;

  await prisma.ledgerEntry.create({
    data: {
      transactionId: transaction.id,
      walletId: wallet.id,
      amount: amountDecimal,
      balanceAfter: newBalance,
      entryType: EntryType.CREDIT, // เงินเข้า = Credit ในมุมมองของ Wallet (Liability ของ Exchange)
    },
  });

  // 4. อัปเดต Wallet จริง
  await prisma.wallet.update({
    where: { id: wallet.id },
    data: {
      availableBalance: { increment: amountDecimal },
    },
  });
}

// ----------------------------------------------------------------------
// 🥇 TIER 1: GOLD SET (ข้อมูลชุดมาตรฐานเพื่อตรวจสอบ)
// ----------------------------------------------------------------------

async function seedGoldSet() {
  console.log('🏆 กำลังสร้าง Gold Set Users (Admin & Demo)...');

  // 1. สร้าง Admin User
  const admin = await prisma.user.create({
    data: {
      email: 'admin@p2p.com',
      passwordHash: SHARED_PASSWORD_HASH,
      fullName: 'System Administrator',
      status: UserStatus.ACTIVE,
      wallets: {
        create: [
          { currencyCode: 'THB' },
          { currencyCode: 'BTC' },
          { currencyCode: 'USDT' },
        ],
      },
    },
    include: { wallets: true },
  });

  console.log(`   - Created Admin: ${admin.email}`);

  // 2. ฝากเงินให้ Admin (Unlimited Power!)
  await depositFunds(admin.id, 'THB', 10_000_000);
  await depositFunds(admin.id, 'BTC', 10);
  await depositFunds(admin.id, 'USDT', 1_000_000);

  // 3. สร้าง Demo Trader A (Buyer)
  const traderA = await prisma.user.create({
    data: {
      email: 'buyer@demo.com',
      passwordHash: SHARED_PASSWORD_HASH,
      fullName: 'Demo Buyer',
      status: UserStatus.ACTIVE,
      wallets: {
        create: [
          { currencyCode: 'THB' }, // มีเงินบาทไว้ซื้อ Crypto
          { currencyCode: 'BTC' },
        ],
      },
    },
  });
  console.log(`   - Created Trader A: ${traderA.email}`);
  await depositFunds(traderA.id, 'THB', 50_000); // มีงบ 50,000 บาท

  // 4. สร้าง Demo Trader B (Seller)
  const traderB = await prisma.user.create({
    data: {
      email: 'seller@demo.com',
      passwordHash: SHARED_PASSWORD_HASH,
      fullName: 'Demo Seller',
      status: UserStatus.ACTIVE,
      wallets: {
        create: [
          { currencyCode: 'THB' },
          { currencyCode: 'BTC' }, // มี BTC ไว้ขาย
        ],
      },
    },
  });
  console.log(`   - Created Trader B: ${traderB.email}`);
  await depositFunds(traderB.id, 'BTC', 2.5); // มี 2.5 BTC
}

// ----------------------------------------------------------------------
// 🎲 TIER 2 & 3: SIMULATION (จำลองข้อมูลจำนวนมาก)
// ----------------------------------------------------------------------

async function seedSimulation(count: number = 20) {
  console.log(`🎲 กำลังจำลองข้อมูล User ทั่วไปจำนวน ${count} คน...`);

  for (let i = 0; i < count; i++) {
    const firstName = faker.person.firstName();
    const lastName = faker.person.lastName();
    const email = faker.internet.email({ firstName, lastName }).toLowerCase();

    // 1. สร้าง User
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: SHARED_PASSWORD_HASH,
        fullName: `${firstName} ${lastName}`,
        status: faker.helpers.arrayElement([
          UserStatus.ACTIVE,
          UserStatus.PENDING_KYC,
        ]),
        wallets: {
          create: [{ currencyCode: 'THB' }, { currencyCode: 'USDT' }],
        },
      },
    });

    // 2. สุ่มแจกเงินถุงเงินถังให้บางคน (Probabilistic)
    if (Math.random() > 0.5) {
      await depositFunds(
        user.id,
        'THB',
        parseFloat(faker.finance.amount({ min: 1000, max: 100000 })),
      );
    }
    if (Math.random() > 0.7) {
      await depositFunds(
        user.id,
        'USDT',
        parseFloat(faker.finance.amount({ min: 10, max: 5000 })),
      );
    }
  }
}

// ----------------------------------------------------------------------
// 🚀 MAIN EXECUTION
// ----------------------------------------------------------------------

async function main() {
  console.log('🚀 เริ่มต้นกระบวนการ Seeding...');
  const start = performance.now();

  try {
    await prepareSharedPassword();
    await cleanDatabase();
    await seedCurrencies();
    await seedGoldSet();
    await seedSimulation(50); // สร้าง 50 Users จำลอง

    const end = performance.now();
    console.log(
      `✅ Seed สำเร็จภายในเวลา ${((end - start) / 1000).toFixed(2)} วินาที`,
    );
  } catch (e) {
    console.error('❌ เกิดข้อผิดพลาดในการ Seed:', e);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
