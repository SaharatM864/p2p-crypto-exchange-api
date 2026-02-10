import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('AuthModule (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();

    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    // Cleanup
    await prisma.user.deleteMany({
      where: { email: { contains: 'e2e-test' } },
    });
    await app.close();
  });

  describe('POST /auth/register', () => {
    const createUserDto = {
      email: `auth-e2e-test-${Date.now()}@example.com`,
      password: 'password123',
      fullName: 'Auth E2E Test User',
    };

    it('should register a new user successfully', () => {
      return request(app.getHttpServer())
        .post('/auth/register')
        .send(createUserDto)
        .expect(201)
        .expect((res) => {
          expect(res.body.message).toBeDefined();
          expect(res.body.data).toBeDefined();
          expect(res.body.data.email).toBe(createUserDto.email);
          expect(res.body.data.passwordHash).toBeUndefined(); // Should not return password
        });
    });

    it('should fail with duplicate email', () => {
      return request(app.getHttpServer())
        .post('/auth/register')
        .send(createUserDto)
        .expect(409); // Conflict
    });

    it('should fail with invalid email', () => {
      return request(app.getHttpServer())
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
      await request(app.getHttpServer()).post('/auth/register').send(loginUser);
    });

    it('should login successfully and return JWT', () => {
      return request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: loginUser.email, password: loginUser.password })
        .expect(201) // Assuming 201 for Login (or 200 depending on implementation)
        .expect((res) => {
          expect(res.body.data.accessToken).toBeDefined();
          expect(res.body.data.user.email).toBe(loginUser.email);
        });
    });

    it('should fail with wrong password', () => {
      return request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: loginUser.email, password: 'wrongpassword' })
        .expect(401); // Unauthorized
    });
  });
});
