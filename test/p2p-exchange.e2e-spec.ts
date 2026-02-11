/**
 * ============================================================================
 * P2P Crypto Exchange — Expert-Level Integration Test Suite
 * ============================================================================
 *
 * ครอบคลุม 5 เกณฑ์หลัก:
 *   1. Financial Precision (Decimal Accuracy)
 *   2. Concurrency & Race Condition (Double Spending Prevention)
 *   3. Ledger Integrity (Zero-Sum Double-Entry Bookkeeping)
 *   4. P2P State Machine & Escrow Logic
 *   5. Transaction Atomicity (Rollback on Failure)
 *
 * ⚠️  ต้องใช้ Database จริง (PostgreSQL ผ่าน Docker) — ไม่ใช้ mock
 * ⚠️  รัน: npx jest --config ./test/jest-e2e.json --verbose
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { OrdersService } from '../src/orders/orders.service';
import { TradesService } from '../src/trades/trades.service';
import { OrderSide, Prisma } from '@prisma/client';
import { TRADING_FEE_RATE } from '../src/common/constants/fee.constants';

// ============================================================================
// SETUP & TEARDOWN
// ============================================================================

describe('P2P Crypto Exchange — Expert-Level Tests', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ordersService: OrdersService;
  let tradesService: TradesService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = app.get(PrismaService);
    ordersService = app.get(OrdersService);
    tradesService = app.get(TradesService);
  });

  afterAll(async () => {
    await app.close();
  });

  // --------------------------------------------------------------------------
  // HELPER: สร้าง User พร้อม Wallet สำหรับ Test
  // --------------------------------------------------------------------------

  async function createTestUser(
    email: string,
    balances: { currency: string; amount: string }[],
  ) {
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: 'test-hash',
        fullName: `Test User (${email})`,
        status: 'ACTIVE',
        wallets: {
          create: balances.map((b) => ({
            currencyCode: b.currency,
            availableBalance: b.amount,
          })),
        },
      },
      include: { wallets: true },
    });
    return user;
  }

  // ============================================================================
  // TEST 1: FINANCIAL PRECISION (ห้ามใช้ Float เด็ดขาด)
  // ============================================================================

  describe('Test 1: Financial Precision (Decimal Accuracy)', () => {
    it('Case 1.1: Satoshi-level addition — 0.00000001 + 0.00000002 = 0.00000003', () => {
      const a = new Prisma.Decimal('0.00000001');
      const b = new Prisma.Decimal('0.00000002');
      const result = a.plus(b);

      // ถ้าใช้ float: 0.00000001 + 0.00000002 อาจได้ 0.000000030000000004
      // Prisma.Decimal.toString() อาจแสดงเป็น scientific notation (3e-8) สำหรับค่าเล็กๆ
      // ดังนั้นใช้ toFixed(8) เพื่อบังคับ format หรือ assert ด้วย .equals()
      expect(result.toFixed(8)).toBe('0.00000003');
      expect(result.equals(new Prisma.Decimal('0.00000003'))).toBe(true);
    });

    it('Case 1.2: Fee calculation precision — 0.001 * 0.12345678 ต้องไม่ปัดเศษผิด', () => {
      const amount = new Prisma.Decimal('0.12345678');
      const feeRate = new Prisma.Decimal(TRADING_FEE_RATE); // 0.001
      const fee = amount.mul(feeRate);

      // 0.12345678 * 0.001 = 0.00012345678
      expect(fee.toString()).toBe('0.00012345678');
    });

    it('Case 1.3: Lock amount calculation — totalAmount * (1 + feeRate) precision', () => {
      const totalAmount = new Prisma.Decimal('1.23456789');
      const feeRate = new Prisma.Decimal(TRADING_FEE_RATE);
      const lockAmount = totalAmount.mul(new Prisma.Decimal(1).plus(feeRate));

      // 1.23456789 * 1.001 = 1.23580245789
      expect(lockAmount.toString()).toBe('1.23580245789');
    });

    it('Case 1.4: Floating point comparison — known JS float problem', () => {
      // ปัญหาคลาสสิกของ JavaScript: 0.1 + 0.2 !== 0.3
      const jsFloat = 0.1 + 0.2;
      expect(jsFloat).not.toBe(0.3); // JS float FAILS!

      // Prisma.Decimal ต้องให้ผลลัพธ์ถูกต้อง
      const a = new Prisma.Decimal('0.1');
      const b = new Prisma.Decimal('0.2');
      const result = a.plus(b);
      expect(result.equals(new Prisma.Decimal('0.3'))).toBe(true); // Decimal PASSES!
    });

    it('Case 1.5: Database round-trip — balance ต้องไม่เพี้ยนหลังบันทึกและอ่านกลับ', async () => {
      const preciseAmount = '0.123456789012345678'; // 18 decimal places (ตาม schema)

      const user = await createTestUser(`precision-${Date.now()}@test.com`, [
        { currency: 'BTC', amount: preciseAmount },
      ]);

      const wallet = await prisma.wallet.findUnique({
        where: {
          userId_currencyCode: {
            userId: user.id,
            currencyCode: 'BTC',
          },
        },
      });

      expect(wallet).not.toBeNull();
      expect(wallet!.availableBalance.toString()).toBe(preciseAmount);
    });
  });

  // ============================================================================
  // TEST 2: CONCURRENCY & RACE CONDITION (ป้องกัน Double Spending)
  // ============================================================================

  describe('Test 2: Concurrency & Race Condition', () => {
    it('Case 2.1: Parallel SELL orders — ต้อง success ตามจำนวน balance เท่านั้น', async () => {
      // Setup: User มี BTC 2.5 — แต่ละ order ใช้ 1 BTC + fee (1.001 BTC)
      // ดังนั้นสามารถสร้างได้สูงสุด 2 orders (2.002 BTC ≤ 2.5)
      // Order ที่ 3 ต้อง fail เพราะเหลือ 0.498 BTC ไม่พอ

      const seller = await createTestUser(
        `concurrent-seller-${Date.now()}@test.com`,
        [
          { currency: 'BTC', amount: '2.5' },
          { currency: 'THB', amount: '0' },
        ],
      );

      interface RequestResult {
        status: 'fulfilled' | 'rejected';
        val?: unknown;
        err?: unknown;
      }

      // ยิง 5 SELL orders พร้อมกัน (1 BTC each)
      const requests: Promise<RequestResult>[] = Array(5)
        .fill(null)
        .map(() =>
          ordersService
            .create(seller.id, {
              side: OrderSide.SELL,
              cryptoCurrency: 'BTC',
              fiatCurrency: 'THB',
              price: 1000000,
              totalAmount: 1,
            })
            .then((res) => ({ status: 'fulfilled' as const, val: res }))
            .catch((err) => ({
              status: 'rejected' as const,
              err: err as unknown,
            })),
        );

      const results: RequestResult[] = await Promise.all(requests);

      const successCount = results.filter(
        (r) => r.status === 'fulfilled',
      ).length;
      const failCount = results.filter((r) => r.status === 'rejected').length;

      console.log(`  ✅ Success: ${successCount}, ❌ Failed: ${failCount}`);

      // ต้อง success ไม่เกิน 2 (2.5 / 1.001 = 2.497 → ได้แค่ 2)
      expect(successCount).toBe(2);
      expect(failCount).toBe(3);

      // ตรวจ balance สุดท้าย — ต้องไม่ติดลบ
      const wallet = await prisma.wallet.findUnique({
        where: {
          userId_currencyCode: {
            userId: seller.id,
            currencyCode: 'BTC',
          },
        },
      });

      expect(wallet).not.toBeNull();
      const availableBalance = Number(wallet!.availableBalance);
      const lockedBalance = Number(wallet!.lockedBalance);

      console.log(`  Available: ${availableBalance}, Locked: ${lockedBalance}`);

      expect(availableBalance).toBeGreaterThanOrEqual(0);
      // locked = 2 * 1.001 = 2.002
      expect(lockedBalance).toBeCloseTo(2.002, 8);
      // available = 2.5 - 2.002 = 0.498
      expect(availableBalance).toBeCloseTo(0.498, 8);
    }, 30000);

    it('Case 2.2: Parallel Trades สำหรับ Order เดียว — ต้อง success รวมไม่เกิน totalAmount', async () => {
      // Setup: Seller มี 1 BTC, Buyers 3 คน จะ trade พร้อมกัน

      const seller = await createTestUser(
        `trade-seller-${Date.now()}@test.com`,
        [
          { currency: 'BTC', amount: '1.5' },
          { currency: 'THB', amount: '0' },
        ],
      );

      // สร้าง SELL order 1 BTC
      const order = await ordersService.create(seller.id, {
        side: OrderSide.SELL,
        cryptoCurrency: 'BTC',
        fiatCurrency: 'THB',
        price: 1000000,
        totalAmount: 1,
      });

      // สร้าง 3 buyers
      const buyers = await Promise.all(
        Array(3)
          .fill(null)
          .map((_, i) =>
            createTestUser(`trade-buyer-${Date.now()}-${i}@test.com`, [
              { currency: 'BTC', amount: '0' },
              { currency: 'THB', amount: '1000000' },
            ]),
          ),
      );

      interface TradeResult {
        status: 'fulfilled' | 'rejected';
        val?: unknown;
        err?: unknown;
      }

      // ยิง 3 trades พร้อมกัน — แต่ละคนซื้อ 0.5 BTC (รวม 1.5 > order 1.0)
      const tradeRequests: Promise<TradeResult>[] = buyers.map((buyer) =>
        tradesService
          .create(buyer.id, {
            orderId: order.id,
            amount: 0.5,
          })
          .then((res) => ({ status: 'fulfilled' as const, val: res }))
          .catch((err) => ({
            status: 'rejected' as const,
            err: err as unknown,
          })),
      );

      const tradeResults: TradeResult[] = await Promise.all(tradeRequests);

      const tradeSuccess = tradeResults.filter(
        (r) => r.status === 'fulfilled',
      ).length;
      const tradeFail = tradeResults.filter(
        (r) => r.status === 'rejected',
      ).length;

      console.log(
        `  Trades — ✅ Success: ${tradeSuccess}, ❌ Failed: ${tradeFail}`,
      );

      // Order = 1 BTC, แต่ละ trade = 0.5 BTC → success สูงสุด 2
      expect(tradeSuccess).toBe(2);
      expect(tradeFail).toBe(1);

      // ตรวจ order status → ต้องเป็น COMPLETED (filled 1.0 / 1.0)
      const updatedOrder = await prisma.order.findUnique({
        where: { id: order.id },
      });
      expect(updatedOrder!.status).toBe('COMPLETED');
      expect(updatedOrder!.filledAmount.toString()).toBe('1');
    }, 30000);
  });

  // ============================================================================
  // TEST 3: LEDGER INTEGRITY (Double-Entry — Zero Sum)
  // ============================================================================

  describe('Test 3: Ledger Integrity (Zero-Sum)', () => {
    it('Case 3.1: Trade release → SUM(ledger amounts) ของ transaction ต้อง = 0', async () => {
      // Setup: Full Trade Flow → COMPLETED
      const seller = await createTestUser(
        `ledger-seller-${Date.now()}@test.com`,
        [
          { currency: 'BTC', amount: '5' },
          { currency: 'THB', amount: '0' },
        ],
      );

      const buyer = await createTestUser(
        `ledger-buyer-${Date.now()}@test.com`,
        [
          { currency: 'BTC', amount: '0' },
          { currency: 'THB', amount: '5000000' },
        ],
      );

      // 1. Create SELL order
      const order = await ordersService.create(seller.id, {
        side: OrderSide.SELL,
        cryptoCurrency: 'BTC',
        fiatCurrency: 'THB',
        price: 1000000,
        totalAmount: 1,
      });

      // 2. Create Trade
      const trade = await tradesService.create(buyer.id, {
        orderId: order.id,
        amount: 1,
      });

      // 3. Buyer marks as PAID
      await tradesService.markPaid(buyer.id, trade.id);

      // 4. Seller releases crypto
      await tradesService.release(seller.id, trade.id);

      // 5. Query Ledger: ดึง entries ของ transaction ที่เกิดจากการ release
      // transaction ล่าสุดที่ description มีคำว่า "release"
      const releaseTx = await prisma.transaction.findFirst({
        where: {
          description: { contains: `Trade ${trade.id} release` },
        },
        include: {
          ledgerEntries: true,
        },
      });

      expect(releaseTx).not.toBeNull();
      expect(releaseTx!.ledgerEntries.length).toBe(3); // seller debit + buyer credit + fee credit

      // Zero-Sum Check: SUM(amount) ต้อง = 0
      const sum = releaseTx!.ledgerEntries.reduce(
        (acc, entry) => acc.plus(entry.amount),
        new Prisma.Decimal(0),
      );

      console.log(
        `  Ledger entries: ${releaseTx!.ledgerEntries.map((e) => e.amount.toString()).join(', ')}`,
      );
      console.log(`  SUM(amount) = ${sum.toString()}`);

      expect(sum.equals(new Prisma.Decimal(0))).toBe(true);

      // ตรวจแยก: Seller debit ต้อง = Buyer credit + Fee credit
      const sellerEntry = releaseTx!.ledgerEntries.find((e) =>
        e.amount.isNegative(),
      );
      const creditEntries = releaseTx!.ledgerEntries.filter(
        (e) => !e.amount.isNegative(),
      );
      const totalCredits = creditEntries.reduce(
        (acc, e) => acc.plus(e.amount),
        new Prisma.Decimal(0),
      );

      expect(sellerEntry!.amount.negated().toString()).toBe(
        totalCredits.toString(),
      );
    });

    it('Case 3.2: Fee calculation ต้องแม่นยำ — fee = tradeAmount * 0.001', async () => {
      const seller = await createTestUser(
        `ledger-fee-seller-${Date.now()}@test.com`,
        [
          { currency: 'BTC', amount: '5' },
          { currency: 'THB', amount: '0' },
        ],
      );

      const buyer = await createTestUser(
        `ledger-fee-buyer-${Date.now()}@test.com`,
        [
          { currency: 'BTC', amount: '0' },
          { currency: 'THB', amount: '5000000' },
        ],
      );

      const tradeAmount = '0.12345678';

      const order = await ordersService.create(seller.id, {
        side: OrderSide.SELL,
        cryptoCurrency: 'BTC',
        fiatCurrency: 'THB',
        price: 1000000,
        totalAmount: 1,
      });

      const trade = await tradesService.create(buyer.id, {
        orderId: order.id,
        amount: parseFloat(tradeAmount),
      });

      await tradesService.markPaid(buyer.id, trade.id);
      await tradesService.release(seller.id, trade.id);

      // ดึง System Fee Wallet
      const systemFeeUser = await prisma.user.findUnique({
        where: { email: 'fees@p2p.com' },
      });

      const releaseTx = await prisma.transaction.findFirst({
        where: {
          description: { contains: `Trade ${trade.id} release` },
        },
        include: { ledgerEntries: true },
      });

      // หา fee entry (เข้า system fee wallet)
      const systemFeeWallet = await prisma.wallet.findUnique({
        where: {
          userId_currencyCode: {
            userId: systemFeeUser!.id,
            currencyCode: 'BTC',
          },
        },
      });

      const feeEntry = releaseTx!.ledgerEntries.find(
        (e) => e.walletId === systemFeeWallet!.id,
      );

      const expectedFee = new Prisma.Decimal(tradeAmount).mul(
        new Prisma.Decimal(TRADING_FEE_RATE),
      );

      console.log(
        `  Fee Entry: ${feeEntry!.amount.toString()}, Expected: ${expectedFee.toString()}`,
      );

      expect(feeEntry!.amount.toString()).toBe(expectedFee.toString());
    });
  });

  // ============================================================================
  // TEST 4: P2P STATE MACHINE & ESCROW LOGIC
  // ============================================================================

  describe('Test 4: State Machine & Escrow', () => {
    it('Case 4.1: Escrow Locking — SELL order ต้อง lock เงินทันที', async () => {
      const seller = await createTestUser(
        `escrow-seller-${Date.now()}@test.com`,
        [
          { currency: 'BTC', amount: '5' },
          { currency: 'THB', amount: '0' },
        ],
      );

      const initialWallet = await prisma.wallet.findUnique({
        where: {
          userId_currencyCode: {
            userId: seller.id,
            currencyCode: 'BTC',
          },
        },
      });

      const initialAvailable = initialWallet!.availableBalance;
      const initialLocked = initialWallet!.lockedBalance;

      expect(initialAvailable.toString()).toBe('5');
      expect(initialLocked.toString()).toBe('0');

      // สร้าง SELL order 2 BTC
      const sellAmount = new Prisma.Decimal('2');
      const feeRate = new Prisma.Decimal(TRADING_FEE_RATE);
      const expectedLock = sellAmount.mul(new Prisma.Decimal(1).plus(feeRate)); // 2.002

      await ordersService.create(seller.id, {
        side: OrderSide.SELL,
        cryptoCurrency: 'BTC',
        fiatCurrency: 'THB',
        price: 1000000,
        totalAmount: 2,
      });

      // ตรวจสอบ wallet หลัง lock
      const afterWallet = await prisma.wallet.findUnique({
        where: {
          userId_currencyCode: {
            userId: seller.id,
            currencyCode: 'BTC',
          },
        },
      });

      console.log(
        `  Before: Available=${initialAvailable.toString()}, Locked=${initialLocked.toString()}`,
      );
      console.log(
        `  After:  Available=${afterWallet!.availableBalance.toString()}, Locked=${afterWallet!.lockedBalance.toString()}`,
      );

      // available ต้องลด, locked ต้องเพิ่ม
      expect(afterWallet!.availableBalance.toString()).toBe(
        initialAvailable.minus(expectedLock).toString(),
      );
      expect(afterWallet!.lockedBalance.toString()).toBe(
        expectedLock.toString(),
      );
    });

    it('Case 4.2: Illegal State Transition — release ต้องทำได้เฉพาะสถานะ PAID', async () => {
      const seller = await createTestUser(
        `state-seller-${Date.now()}@test.com`,
        [
          { currency: 'BTC', amount: '5' },
          { currency: 'THB', amount: '0' },
        ],
      );

      const buyer = await createTestUser(`state-buyer-${Date.now()}@test.com`, [
        { currency: 'BTC', amount: '0' },
        { currency: 'THB', amount: '5000000' },
      ]);

      const order = await ordersService.create(seller.id, {
        side: OrderSide.SELL,
        cryptoCurrency: 'BTC',
        fiatCurrency: 'THB',
        price: 1000000,
        totalAmount: 1,
      });

      const trade = await tradesService.create(buyer.id, {
        orderId: order.id,
        amount: 1,
      });

      // trade อยู่ที่ PENDING_PAYMENT — พยายาม release ข้าม PAID
      await expect(tradesService.release(seller.id, trade.id)).rejects.toThrow(
        'Trade must be PAID first',
      );

      // ตรวจสอบ trade status ยังเป็น PENDING_PAYMENT
      const unchangedTrade = await prisma.trade.findUnique({
        where: { id: trade.id },
      });
      expect(unchangedTrade!.status).toBe('PENDING_PAYMENT');
    });

    it('Case 4.2b: Illegal markPaid — buyer เท่านั้นที่ pay ได้', async () => {
      const seller = await createTestUser(
        `auth-seller-${Date.now()}@test.com`,
        [
          { currency: 'BTC', amount: '5' },
          { currency: 'THB', amount: '0' },
        ],
      );

      const buyer = await createTestUser(`auth-buyer-${Date.now()}@test.com`, [
        { currency: 'BTC', amount: '0' },
        { currency: 'THB', amount: '5000000' },
      ]);

      const order = await ordersService.create(seller.id, {
        side: OrderSide.SELL,
        cryptoCurrency: 'BTC',
        fiatCurrency: 'THB',
        price: 1000000,
        totalAmount: 1,
      });

      const trade = await tradesService.create(buyer.id, {
        orderId: order.id,
        amount: 1,
      });

      // Seller พยายาม markPaid → ต้อง error
      await expect(tradesService.markPaid(seller.id, trade.id)).rejects.toThrow(
        'Only buyer can mark as paid',
      );
    });

    it('Case 4.3: Cancel Trade — เงินที่ lock ต้องกลับคืน available', async () => {
      const seller = await createTestUser(
        `cancel-seller-${Date.now()}@test.com`,
        [
          { currency: 'BTC', amount: '5' },
          { currency: 'THB', amount: '0' },
        ],
      );

      const buyer = await createTestUser(
        `cancel-buyer-${Date.now()}@test.com`,
        [
          { currency: 'BTC', amount: '0' },
          { currency: 'THB', amount: '5000000' },
        ],
      );

      // จด balance ก่อนสร้าง order
      const beforeWallet = await prisma.wallet.findUnique({
        where: {
          userId_currencyCode: {
            userId: seller.id,
            currencyCode: 'BTC',
          },
        },
      });
      const beforeAvailable = beforeWallet!.availableBalance;

      // สร้าง SELL order
      const order = await ordersService.create(seller.id, {
        side: OrderSide.SELL,
        cryptoCurrency: 'BTC',
        fiatCurrency: 'THB',
        price: 1000000,
        totalAmount: 1,
      });

      // สร้าง Trade
      const trade = await tradesService.create(buyer.id, {
        orderId: order.id,
        amount: 1,
      });

      // ตรวจว่าเงินถูก lock
      const duringWallet = await prisma.wallet.findUnique({
        where: {
          userId_currencyCode: {
            userId: seller.id,
            currencyCode: 'BTC',
          },
        },
      });
      expect(Number(duringWallet!.lockedBalance)).toBeGreaterThan(0);

      // Cancel Trade
      await tradesService.cancel(buyer.id, trade.id);

      // ตรวจ balance หลัง cancel — available ต้องกลับมาเท่าเดิม
      const afterWallet = await prisma.wallet.findUnique({
        where: {
          userId_currencyCode: {
            userId: seller.id,
            currencyCode: 'BTC',
          },
        },
      });

      console.log(
        `  Before: ${beforeAvailable.toString()}, After Cancel: ${afterWallet!.availableBalance.toString()}`,
      );

      expect(afterWallet!.availableBalance.toString()).toBe(
        beforeAvailable.toString(),
      );
      expect(afterWallet!.lockedBalance.toString()).toBe('0');

      // Order ต้องกลับเป็น OPEN
      const afterOrder = await prisma.order.findUnique({
        where: { id: order.id },
      });
      expect(afterOrder!.status).toBe('OPEN');
      expect(afterOrder!.filledAmount.toString()).toBe('0');
    });

    it('Case 4.4: Self-trade prevention — ห้ามเทรดกับ order ตัวเอง', async () => {
      const user = await createTestUser(`self-trade-${Date.now()}@test.com`, [
        { currency: 'BTC', amount: '5' },
        { currency: 'THB', amount: '5000000' },
      ]);

      const order = await ordersService.create(user.id, {
        side: OrderSide.SELL,
        cryptoCurrency: 'BTC',
        fiatCurrency: 'THB',
        price: 1000000,
        totalAmount: 1,
      });

      // พยายาม trade กับ order ตัวเอง
      await expect(
        tradesService.create(user.id, {
          orderId: order.id,
          amount: 0.5,
        }),
      ).rejects.toThrow('Cannot trade with your own order');
    });
  });

  // ============================================================================
  // TEST 5: TRANSACTION ATOMICITY (Rollback on Failure)
  // ============================================================================

  describe('Test 5: Transaction Atomicity (Rollback)', () => {
    it('Case 5.1: Trade amount เกิน remaining → ต้อง error และ balance ไม่เปลี่ยน', async () => {
      const seller = await createTestUser(
        `atomic-seller-${Date.now()}@test.com`,
        [
          { currency: 'BTC', amount: '5' },
          { currency: 'THB', amount: '0' },
        ],
      );

      const buyer = await createTestUser(
        `atomic-buyer-${Date.now()}@test.com`,
        [
          { currency: 'BTC', amount: '0' },
          { currency: 'THB', amount: '5000000' },
        ],
      );

      // สร้าง SELL order 1 BTC
      const order = await ordersService.create(seller.id, {
        side: OrderSide.SELL,
        cryptoCurrency: 'BTC',
        fiatCurrency: 'THB',
        price: 1000000,
        totalAmount: 1,
      });

      // จด state ก่อน
      const orderBefore = await prisma.order.findUnique({
        where: { id: order.id },
      });
      const filledBefore = orderBefore!.filledAmount;

      // พยายาม trade 2 BTC จาก order ที่มีแค่ 1 BTC → ต้อง error
      await expect(
        tradesService.create(buyer.id, {
          orderId: order.id,
          amount: 2,
        }),
      ).rejects.toThrow('Insufficient amount in order');

      // ตรวจว่า order ไม่เปลี่ยน
      const orderAfter = await prisma.order.findUnique({
        where: { id: order.id },
      });
      expect(orderAfter!.filledAmount.toString()).toBe(filledBefore.toString());
      expect(orderAfter!.status).toBe('OPEN');
    });

    it('Case 5.2: Insufficient balance for SELL order → balance ต้องไม่เปลี่ยน', async () => {
      const seller = await createTestUser(
        `insuf-seller-${Date.now()}@test.com`,
        [
          { currency: 'BTC', amount: '0.5' }, // มีแค่ 0.5 BTC
          { currency: 'THB', amount: '0' },
        ],
      );

      // จด balance ก่อน
      const walletBefore = await prisma.wallet.findUnique({
        where: {
          userId_currencyCode: {
            userId: seller.id,
            currencyCode: 'BTC',
          },
        },
      });

      // พยายามสร้าง SELL order 1 BTC (ต้องล็อค 1.001 BTC > 0.5 BTC)
      await expect(
        ordersService.create(seller.id, {
          side: OrderSide.SELL,
          cryptoCurrency: 'BTC',
          fiatCurrency: 'THB',
          price: 1000000,
          totalAmount: 1,
        }),
      ).rejects.toThrow('Insufficient balance');

      // Balance ต้องไม่เปลี่ยน (Rollback สมบูรณ์)
      const walletAfter = await prisma.wallet.findUnique({
        where: {
          userId_currencyCode: {
            userId: seller.id,
            currencyCode: 'BTC',
          },
        },
      });

      expect(walletAfter!.availableBalance.toString()).toBe(
        walletBefore!.availableBalance.toString(),
      );
      expect(walletAfter!.lockedBalance.toString()).toBe(
        walletBefore!.lockedBalance.toString(),
      );
    });

    it('Case 5.3: Cancel trade ที่ COMPLETED แล้ว → ต้อง error และ balance ไม่เปลี่ยน', async () => {
      const seller = await createTestUser(
        `completed-seller-${Date.now()}@test.com`,
        [
          { currency: 'BTC', amount: '5' },
          { currency: 'THB', amount: '0' },
        ],
      );

      const buyer = await createTestUser(
        `completed-buyer-${Date.now()}@test.com`,
        [
          { currency: 'BTC', amount: '0' },
          { currency: 'THB', amount: '5000000' },
        ],
      );

      // Full flow → COMPLETED
      const order = await ordersService.create(seller.id, {
        side: OrderSide.SELL,
        cryptoCurrency: 'BTC',
        fiatCurrency: 'THB',
        price: 1000000,
        totalAmount: 1,
      });

      const trade = await tradesService.create(buyer.id, {
        orderId: order.id,
        amount: 1,
      });

      await tradesService.markPaid(buyer.id, trade.id);
      await tradesService.release(seller.id, trade.id);

      // จด balances หลัง complete
      const sellerWalletBefore = await prisma.wallet.findUnique({
        where: {
          userId_currencyCode: {
            userId: seller.id,
            currencyCode: 'BTC',
          },
        },
      });
      const buyerWalletBefore = await prisma.wallet.findUnique({
        where: {
          userId_currencyCode: {
            userId: buyer.id,
            currencyCode: 'BTC',
          },
        },
      });

      // พยายาม cancel trade ที่ COMPLETED → ต้อง error
      await expect(tradesService.cancel(seller.id, trade.id)).rejects.toThrow(
        'Cannot cancel finished trade',
      );

      // Balance ต้องไม่เปลี่ยน
      const sellerWalletAfter = await prisma.wallet.findUnique({
        where: {
          userId_currencyCode: {
            userId: seller.id,
            currencyCode: 'BTC',
          },
        },
      });
      const buyerWalletAfter = await prisma.wallet.findUnique({
        where: {
          userId_currencyCode: {
            userId: buyer.id,
            currencyCode: 'BTC',
          },
        },
      });

      expect(sellerWalletAfter!.availableBalance.toString()).toBe(
        sellerWalletBefore!.availableBalance.toString(),
      );
      expect(buyerWalletAfter!.availableBalance.toString()).toBe(
        buyerWalletBefore!.availableBalance.toString(),
      );
    });
  });
});
