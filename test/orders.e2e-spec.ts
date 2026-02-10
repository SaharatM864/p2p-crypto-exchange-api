import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { OrderSide } from '@prisma/client';

describe('OrdersModule (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let authToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();

    prisma = app.get(PrismaService);

    // Setup: Create User and Login
    const email = `orders-e2e-${Date.now()}@example.com`;
    await request(app.getHttpServer()).post('/auth/register').send({
      email,
      password: 'password123',
      fullName: 'Orders E2E User',
    });

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'password123' });

    authToken = loginRes.body.data.accessToken;

    // Add Balance for Testing
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) throw new Error('User not found');
    await prisma.wallet.updateMany({
      where: { userId: user.id, currencyCode: 'BTC' },
      data: { availableBalance: 10 },
    });
    await prisma.wallet.updateMany({
      where: { userId: user.id, currencyCode: 'USDT' },
      data: { availableBalance: 10000 },
    });
  });

  afterAll(async () => {
    await prisma.order.deleteMany({
      where: { user: { email: { contains: 'orders-e2e' } } },
    });
    await prisma.user.deleteMany({
      where: { email: { contains: 'orders-e2e' } },
    });
    await app.close();
  });

  describe('POST /orders', () => {
    it('should create a SELL order successfully', () => {
      return request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          side: OrderSide.SELL,
          cryptoCurrency: 'BTC',
          fiatCurrency: 'THB',
          price: 1000000,
          totalAmount: 1,
        })
        .expect(201)
        .expect((res) => {
          expect(res.body.data.id).toBeDefined();
          expect(res.body.data.status).toBe('OPEN');
        });
    });

    it('should fail if insufficient balance', () => {
      return request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          side: OrderSide.SELL,
          cryptoCurrency: 'BTC',
          fiatCurrency: 'THB',
          price: 1000000,
          totalAmount: 20, // More than 10
        })
        .expect(400); // Bad Request (Insufficient balance)
    });
  });

  describe('GET /orders', () => {
    it('should return list of orders', () => {
      return request(app.getHttpServer())
        .get('/orders')
        .query({ page: 1, limit: 10 })
        .expect(200)
        .expect((res) => {
          expect(Array.isArray(res.body.data)).toBe(true);
          expect(res.body.meta).toBeDefined();
        });
    });
  });
});
