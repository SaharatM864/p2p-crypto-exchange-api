import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { OrderSide } from '@prisma/client';

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
    await app.init();

    prisma = app.get(PrismaService);

    // Setup: Create Seller
    const sellerEmail = `seller-e2e-${Date.now()}@example.com`;
    await request(app.getHttpServer()).post('/auth/register').send({
      email: sellerEmail,
      password: 'password123',
      fullName: 'Seller E2E',
    });
    const sellerLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: sellerEmail, password: 'password123' });
    sellerToken = sellerLogin.body.data.accessToken;

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
    await request(app.getHttpServer()).post('/auth/register').send({
      email: buyerEmail,
      password: 'password123',
      fullName: 'Buyer E2E',
    });
    const buyerLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: buyerEmail, password: 'password123' });
    buyerToken = buyerLogin.body.data.accessToken;

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
    const orderRes = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({
        side: OrderSide.SELL,
        cryptoCurrency: 'BTC',
        fiatCurrency: 'THB',
        price: 1000000,
        totalAmount: 1,
      });
    orderId = orderRes.body.data.id;
  });

  afterAll(async () => {
    await prisma.trade.deleteMany({
      where: { order: { user: { email: { contains: 'e2e' } } } },
    });
    await prisma.order.deleteMany({
      where: { user: { email: { contains: 'e2e' } } },
    });
    await prisma.user.deleteMany({ where: { email: { contains: 'e2e' } } });
    await app.close();
  });

  describe('Trade Full Loop', () => {
    let tradeId: string;

    it('Step 1: Buyer creates trade', () => {
      return request(app.getHttpServer())
        .post('/trades')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({
          orderId: orderId,
          amount: 0.5,
        })
        .expect(201)
        .expect((res) => {
          tradeId = res.body.data.id;
          expect(res.body.data.status).toBe('PENDING_PAYMENT');
        });
    });

    it('Step 2: Buyer marks as paid', () => {
      return request(app.getHttpServer())
        .post(`/trades/${tradeId}/paid`)
        .set('Authorization', `Bearer ${buyerToken}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.data.status).toBe('PAID');
        });
    });

    it('Step 3: Seller releases', () => {
      return request(app.getHttpServer())
        .post(`/trades/${tradeId}/release`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.data.status).toBe('COMPLETED');
        });
    });

    it('Step 4: Check trade details', () => {
      return request(app.getHttpServer())
        .get(`/trades/${tradeId}`)
        .set('Authorization', `Bearer ${buyerToken}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.data.id).toBe(tradeId);
          expect(res.body.data.status).toBe('COMPLETED');
        });
    });
  });
});
