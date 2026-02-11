import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { Server } from 'http';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { ApiResponse, AuthResponse, PageDto } from './test-types';
import { Wallet } from '@prisma/client';
import { TransformInterceptor } from '../src/common/interceptors/transform.interceptor';

describe('WalletsModule (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let authToken: string;
  let userId: string;

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
    const email = `active-wallet-e2e-${Date.now()}@example.com`;
    await request(app.getHttpServer() as Server)
      .post('/auth/register')
      .send({
        email,
        password: 'password123',
        fullName: 'Wallet User',
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
    userId = body.data.user.id; // Assuming user ID is returned

    // Add Balance
    await prisma.wallet.updateMany({
      where: { userId, currencyCode: 'BTC' },
      data: { availableBalance: 5 },
    });
  });

  afterAll(async () => {
    // Cleanup
    await prisma.wallet.deleteMany({
      where: { user: { email: { contains: 'wallet-e2e' } } },
    });
    await prisma.user.deleteMany({
      where: { email: { contains: 'wallet-e2e' } },
    });
    await app.close();
  });

  describe('GET /wallets', () => {
    it('should return user wallets with correct balance', () => {
      return request(app.getHttpServer() as Server)
        .get('/wallets')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)
        .expect((res) => {
          const body = res.body as ApiResponse<Wallet[]>;
          expect(Array.isArray(body.data)).toBe(true);
          const btcWallet = body.data.find(
            (w: Wallet) => w.currencyCode === 'BTC',
          );
          expect(btcWallet).toBeDefined();
          if (btcWallet) {
            // Prisma decimal might be returned as string
            expect(Number(btcWallet.availableBalance)).toBe(5);
          }
        });
    });

    it('should fail without auth token', () => {
      return request(app.getHttpServer() as Server)
        .get('/wallets')
        .expect(401);
    });
  });

  describe('GET /wallets/transactions', () => {
    // Note: Transaction history might be empty initially
    it('should return transaction history', () => {
      return request(app.getHttpServer() as Server)
        .get('/wallets/transactions')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ page: 1, limit: 10 })
        .expect(200)
        .expect((res) => {
          const body = res.body as ApiResponse<PageDto<any>>;
          expect(body.data.data).toBeDefined();
          expect(body.data.meta).toBeDefined();
        });
    });
  });
});
