import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { Server } from 'http';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { OrderSide, Order } from '@prisma/client';
import { ApiResponse, AuthResponse } from './test-types';
import { TransformInterceptor } from '../src/common/interceptors/transform.interceptor';

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
    app.useGlobalInterceptors(new TransformInterceptor());
    await app.init();

    prisma = app.get(PrismaService);

    // Setup: Create User and Login
    const email = `orders-e2e-${Date.now()}@example.com`;
    await request(app.getHttpServer() as Server)
      .post('/auth/register')
      .send({
        email,
        password: 'password123',
        fullName: 'Orders E2E User',
      });

    const loginRes = await request(app.getHttpServer() as Server)
      .post('/auth/login')
      .send({ email, password: 'password123' });

    if (loginRes.status !== 200 && loginRes.status !== 201) {
      console.error('Login failed:', JSON.stringify(loginRes.body, null, 2));
      throw new Error(`Login failed with status ${loginRes.status}`);
    }

    const body = loginRes.body as ApiResponse<AuthResponse>;
    authToken = body.data.accessToken;

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
    // Cleanup - Delete trades first
    await prisma.trade.deleteMany({
      where: {
        OR: [
          { buyer: { email: { contains: 'orders-e2e' } } },
          { seller: { email: { contains: 'orders-e2e' } } },
        ],
      },
    });

    // Delete orders
    await prisma.order.deleteMany({
      where: { user: { email: { contains: 'orders-e2e' } } },
    });

    // Delete wallets
    const users = await prisma.user.findMany({
      where: { email: { contains: 'orders-e2e' } },
    });
    if (users.length > 0) {
      await prisma.ledgerEntry.deleteMany({
        where: { wallet: { userId: { in: users.map((u) => u.id) } } },
      });
      await prisma.wallet.deleteMany({
        where: { userId: { in: users.map((u) => u.id) } },
      });
      await prisma.externalTransfer.deleteMany({
        where: { userId: { in: users.map((u) => u.id) } },
      });
    }

    // Delete users
    await prisma.user.deleteMany({
      where: { email: { contains: 'orders-e2e' } },
    });

    await app.close();
  });

  describe('POST /orders', () => {
    it('should create a SELL order successfully', () => {
      return request(app.getHttpServer() as Server)
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
          const body = res.body as ApiResponse<Order>;
          expect(body.data.id).toBeDefined();
          expect(body.data.status).toBe('OPEN');
        });
    });

    it('should fail if insufficient balance', () => {
      return request(app.getHttpServer() as Server)
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
      return (
        request(app.getHttpServer() as Server)
          .get('/orders')
          // .query({ page: 1, limit: 10 }) // Pagination not implemented in controller
          .expect(200)
          .expect((res) => {
            const body = res.body as ApiResponse<Order[]>;
            expect(Array.isArray(body.data)).toBe(true);
            // expect(body.meta).toBeDefined(); // No meta in non-paginated response
          })
      );
    });
  });
});
