import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { OrdersService } from '../src/orders/orders.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { OrderSide } from '@prisma/client';

describe('Concurrency Check (e2e)', () => {
  let app: INestApplication;
  let ordersService: OrdersService;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    ordersService = app.get(OrdersService);
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('should prevent double spending when creating orders concurrently', async () => {
    console.log('🧪 Starting Concurrency Test...');

    // 1. Setup: Create a user with limited balance
    const email = `test-${Date.now()}@concurrent.com`;
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: 'hash',
        fullName: 'Concurrency Tester',
        status: 'ACTIVE',
        wallets: {
          create: [
            { currencyCode: 'THB', availableBalance: 0 },
            { currencyCode: 'BTC', availableBalance: 2.5 },
          ],
        },
      },
      include: { wallets: true },
    });

    const btcWallet = user.wallets.find((w) => w.currencyCode === 'BTC');

    if (!btcWallet) {
      throw new Error('BTC Wallet not initialized');
    }

    console.log(`Reference Wallet ID: ${btcWallet.id}`);
    // Fix: Convert Decimal to string
    console.log(`Initial Balance: ${btcWallet.availableBalance.toString()}`);

    interface RequestResult {
      status: 'fulfilled' | 'rejected';
      val?: unknown;
      err?: unknown;
    }

    // 2. Attack: Send 5 order requests simultaneously
    const requests: Promise<RequestResult>[] = Array(5)
      .fill(null)
      .map(() => {
        return ordersService
          .create(user.id, {
            side: OrderSide.SELL, // Sell BTC
            cryptoCurrency: 'BTC',
            fiatCurrency: 'THB',
            price: 1000000,
            totalAmount: 1, // 1 BTC
          })
          .then((res: unknown) => ({ status: 'fulfilled' as const, val: res }))
          .catch((err: unknown) => ({ status: 'rejected' as const, err }));
      });

    console.log('🚀 Firing 5 concurrent SELL orders (1.0 BTC each)...');

    const results: RequestResult[] = await Promise.all(requests);

    // Fix: Safe typed access
    const successCount = results.filter((r) => r.status === 'fulfilled').length;
    const failCount = results.filter((r) => r.status === 'rejected').length;

    console.log(`✅ Success: ${successCount}`);
    console.log(`❌ Failed: ${failCount}`);

    // Verification
    const updatedWallet = await prisma.wallet.findUnique({
      where: { id: btcWallet.id },
    });

    if (!updatedWallet) {
      throw new Error('Wallet not found');
    }

    // Fix: Convert Decimal to string
    console.log(
      `Final Available Balance: ${updatedWallet.availableBalance.toString()}`,
    );
    console.log(
      `Final Locked Balance: ${updatedWallet.lockedBalance.toString()}`,
    );

    // Assertions
    expect(Number(updatedWallet.availableBalance)).toBeGreaterThanOrEqual(0);
    expect(successCount).toBe(2);
    expect(failCount).toBe(3);
  }, 30000); // 30s timeout
});
