import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { Server } from 'net';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { OrderSide } from '@prisma/client';
import { TransformInterceptor } from '../src/common/interceptors/transform.interceptor';

interface ApiResponse<T> {
  data: T;
  message?: string;
}

interface LoginData {
  accessToken: string;
}

interface TradeData {
  id: string;
  status: string;
}

interface OrderData {
  id: string;
}

describe('TradesModule (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let sellerToken: string;
  let buyerToken: string;
  let orderId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    app.useGlobalInterceptors(new TransformInterceptor());
    await app.init();

    prisma = app.get(PrismaService);

    // Setup: Ensure Currencies Exist (Prerequisite for Wallet Creation)
    const currencies = ['BTC', 'ETH', 'USDT', 'THB', 'USD'];
    for (const code of currencies) {
      await prisma.currency.upsert({
        where: { code },
        update: {},
        create: {
          code,
          name: code,
          type: ['BTC', 'ETH'].includes(code) ? 'CRYPTO' : 'FIAT',
          decimalPlaces: ['BTC', 'ETH'].includes(code) ? 8 : 2,
        },
      });
    }

    // Setup: Create Seller
    const sellerEmail = `seller-e2e-${Date.now()}@example.com`;
    await request(app.getHttpServer() as Server)
      .post('/auth/register')
      .send({
        email: sellerEmail,
        password: 'password123',
        fullName: 'Seller E2E',
      });

    const sellerLogin = await request(app.getHttpServer() as Server)
      .post('/auth/login')
      .send({ email: sellerEmail, password: 'password123' });

    sellerToken = (sellerLogin.body as ApiResponse<LoginData>).data.accessToken;

    // Add Balance to Seller
    const sellerUser = await prisma.user.findUnique({
      where: { email: sellerEmail },
    });
    if (!sellerUser) throw new Error('Seller not found');
    await prisma.wallet.updateMany({
      where: { userId: sellerUser.id, currencyCode: 'BTC' },
      data: { availableBalance: 10 },
    });

    // Setup: Create Buyer
    const buyerEmail = `buyer-e2e-${Date.now()}@example.com`;
    await request(app.getHttpServer() as Server)
      .post('/auth/register')
      .send({
        email: buyerEmail,
        password: 'password123',
        fullName: 'Buyer E2E',
      });
    const buyerLogin = await request(app.getHttpServer() as Server)
      .post('/auth/login')
      .send({ email: buyerEmail, password: 'password123' });
    buyerToken = (buyerLogin.body as ApiResponse<LoginData>).data.accessToken;

    // Add Balance to Buyer (Fiat)
    const buyerUser = await prisma.user.findUnique({
      where: { email: buyerEmail },
    });
    if (!buyerUser) throw new Error('Buyer not found');
    await prisma.wallet.updateMany({
      where: { userId: buyerUser.id, currencyCode: 'THB' },
      data: { availableBalance: 1000000 },
    });

    // Setup: Seller Creates Order
    const orderRes = await request(app.getHttpServer() as Server)
      .post('/orders')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({
        side: OrderSide.SELL,
        cryptoCurrency: 'BTC',
        fiatCurrency: 'THB',
        price: 1000000,
        totalAmount: 1,
      });
    orderId = (orderRes.body as ApiResponse<OrderData>).data.id;

    // Setup: Create System Fee User (Required for Release)
    const feeEmail = 'fees@p2p.com';
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const feeUser = await prisma.user.upsert({
      where: { email: feeEmail },
      update: {},
      create: {
        email: feeEmail,
        passwordHash: 'system_managed',
        fullName: 'System Fee',
        status: 'ACTIVE',
        wallets: {
          create: [{ currencyCode: 'BTC' }, { currencyCode: 'THB' }],
        },
      },
    });
  });

  afterAll(async () => {
    // 1. Delete LedgerEntries by transaction (handles Trade and System Fee entries)
    const transactions = await prisma.transaction.findMany({
      where: { description: { contains: 'Trade' } },
    });
    const txIds = transactions.map((t) => t.id);

    await prisma.ledgerEntry.deleteMany({
      where: { transactionId: { in: txIds } },
    });

    await prisma.transaction.deleteMany({
      where: { id: { in: txIds } },
    });

    // 2. Delete Trade and Order
    await prisma.trade.deleteMany({
      where: { order: { user: { email: { contains: 'e2e' } } } },
    });
    await prisma.order.deleteMany({
      where: { user: { email: { contains: 'e2e' } } },
    });

    // 3. Delete leftover LedgerEntries for Wallets (just in case)
    await prisma.ledgerEntry.deleteMany({
      where: { wallet: { user: { email: { contains: 'e2e' } } } },
    });

    // 4. Delete Wallets and Users
    await prisma.wallet.deleteMany({
      where: { user: { email: { contains: 'e2e' } } },
    });

    await prisma.user.deleteMany({ where: { email: { contains: 'e2e' } } });
    await app.close();
  });

  describe('Trade Full Loop', () => {
    let tradeId: string;

    it('Step 1: Buyer creates trade', () => {
      return request(app.getHttpServer() as Server)
        .post('/trades')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({
          orderId: orderId,
          amount: 0.5,
        })
        .expect(201)
        .expect((res: request.Response) => {
          const body = res.body as ApiResponse<TradeData>;
          tradeId = body.data.id;
          expect(body.data.status).toBe('PENDING_PAYMENT');
        });
    });

    it('Step 2: Buyer marks as paid', () => {
      return request(app.getHttpServer() as Server)
        .post(`/trades/${tradeId}/pay`)
        .set('Authorization', `Bearer ${buyerToken}`)
        .expect(201)
        .expect((res: request.Response) => {
          const body = res.body as ApiResponse<TradeData>;
          expect(body.data.status).toBe('PAID');
        });
    });

    it('Step 3: Seller releases', () => {
      return request(app.getHttpServer() as Server)
        .post(`/trades/${tradeId}/release`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .expect(201)
        .expect((res: request.Response) => {
          const body = res.body as ApiResponse<TradeData>;
          expect(body.data.status).toBe('COMPLETED');
        });
    });

    it('Step 4: Check trade details', () => {
      return request(app.getHttpServer() as Server)
        .get(`/trades/${tradeId}`)
        .set('Authorization', `Bearer ${buyerToken}`)
        .expect(200)
        .expect((res: request.Response) => {
          const body = res.body as ApiResponse<TradeData>;
          expect(body.data.id).toBe(tradeId);
          expect(body.data.status).toBe('COMPLETED');
        });
    });
  });
});
