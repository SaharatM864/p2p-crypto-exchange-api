import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

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
    await app.init();

    prisma = app.get(PrismaService);

    // Setup: Create User and Login
    const email = `active-wallet-e2e-${Date.now()}@example.com`;
    await request(app.getHttpServer()).post('/auth/register').send({
      email,
      password: 'password123',
      fullName: 'Wallet User',
    });

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'password123' });

    authToken = loginRes.body.data.accessToken;
    userId = loginRes.body.data.user.id; // Assuming user ID is returned

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
      return request(app.getHttpServer())
        .get('/wallets')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)
        .expect((res) => {
          expect(Array.isArray(res.body.data)).toBe(true);
          const btcWallet = res.body.data.find(
            (w: any) => w.currencyCode === 'BTC',
          );
          expect(btcWallet).toBeDefined();
          // Prisma decimal might be returned as string
          expect(Number(btcWallet.availableBalance)).toBe(5);
        });
    });

    it('should fail without auth token', () => {
      return request(app.getHttpServer()).get('/wallets').expect(401);
    });
  });

  describe('GET /wallets/transactions', () => {
    // Note: Transaction history might be empty initially
    it('should return transaction history', () => {
      return request(app.getHttpServer())
        .get('/wallets/transactions')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ page: 1, limit: 10 })
        .expect(200)
        .expect((res) => {
          expect(res.body.data).toBeDefined();
          expect(res.body.meta).toBeDefined();
        });
    });
  });
});
