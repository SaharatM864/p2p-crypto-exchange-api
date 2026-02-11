import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Server } from 'http';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { TransformInterceptor } from '../src/common/interceptors/transform.interceptor';

interface AuthResponseBody {
  message: string;
  data: {
    email: string;
    passwordHash?: string;
    accessToken?: string;
    user?: {
      email: string;
    };
  };
}

describe('AuthModule (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    app.useGlobalInterceptors(new TransformInterceptor());
    await app.init();

    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    // Cleanup
    const testUsers = await prisma.user.findMany({
      where: { email: { contains: 'e2e-test' } },
    });
    if (testUsers.length > 0) {
      await prisma.wallet.deleteMany({
        where: { userId: { in: testUsers.map((u) => u.id) } },
      });
      await prisma.user.deleteMany({
        where: { id: { in: testUsers.map((u) => u.id) } },
      });
    }
    await app.close();
  });

  describe('POST /auth/register', () => {
    const createUserDto = {
      email: `auth-e2e-test-${Date.now()}@example.com`,
      password: 'password123',
      fullName: 'Auth E2E Test User',
    };

    it('should register a new user successfully', () => {
      return request(app.getHttpServer() as Server)
        .post('/auth/register')
        .send(createUserDto)
        .expect(201)
        .expect((res: request.Response) => {
          const body = res.body as AuthResponseBody;
          expect(body.message).toBeDefined();
          expect(body.data).toBeDefined();
          expect(body.data.email).toBe(createUserDto.email);
          expect(body.data.passwordHash).toBeUndefined(); // Should not return password
        });
    });

    it('should fail with duplicate email', () => {
      return request(app.getHttpServer() as Server)
        .post('/auth/register')
        .send(createUserDto)
        .expect(409); // Conflict
    });

    it('should fail with invalid email', () => {
      return request(app.getHttpServer() as Server)
        .post('/auth/register')
        .send({ ...createUserDto, email: 'invalid-email' })
        .expect(400); // Bad Request
    });
  });

  describe('POST /auth/login', () => {
    const loginUser = {
      email: `login-e2e-test-${Date.now()}@example.com`,
      password: 'password123',
      fullName: 'Login E2E User',
    };

    beforeAll(async () => {
      await request(app.getHttpServer() as Server)
        .post('/auth/register')
        .send(loginUser);
    });

    it('should login successfully and return JWT', () => {
      return request(app.getHttpServer() as Server)
        .post('/auth/login')
        .send({ email: loginUser.email, password: loginUser.password })
        .expect(200) // Assuming 201 for Login (or 200 depending on implementation)
        .expect((res: request.Response) => {
          const body = res.body as AuthResponseBody;
          expect(body.data.accessToken).toBeDefined();
          expect(body.data.user?.email).toBe(loginUser.email);
        });
    });

    it('should fail with wrong password', () => {
      return request(app.getHttpServer() as Server)
        .post('/auth/login')
        .send({ email: loginUser.email, password: 'wrongpassword' })
        .expect(401); // Unauthorized
    });
  });
});
