import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { MockProxy, mock } from 'jest-mock-extended';
import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';

// Mock argon2
jest.mock('argon2');

describe('AuthService', () => {
  let service: AuthService;
  let prisma: DeepMockProxy<PrismaService>;
  let jwtService: MockProxy<JwtService>;

  beforeEach(async () => {
    prisma = mockDeep<PrismaService>();
    jwtService = mock<JwtService>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwtService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  describe('register', () => {
    const registerDto = {
      email: 'test@example.com',
      password: 'password123',
      fullName: 'Test User',
    };

    it('should register a new user successfully', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
      (argon2.hash as jest.Mock).mockResolvedValue('hashed_password');
      (prisma.$transaction as jest.Mock).mockImplementation(
        (cb: (prisma: any) => Promise<any>) => cb(prisma),
      );
      (prisma.user.create as jest.Mock).mockResolvedValue({
        id: 'user-id',
        ...registerDto,
        password: 'hashed_password',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.register(registerDto);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: registerDto.email },
      });
      expect(argon2.hash).toHaveBeenCalledWith(registerDto.password);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(prisma.user.create).toHaveBeenCalled();
      expect(result).toEqual(
        expect.objectContaining({
          id: 'user-id',
          email: registerDto.email,
          fullName: registerDto.fullName,
        }),
      );
    });

    it('should throw ConflictException if email already exists', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'existing-id',
      } as any);

      await expect(service.register(registerDto)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('login', () => {
    const loginDto = {
      email: 'test@example.com',
      password: 'password123',
    };
    const user = {
      id: 'user-id',
      email: loginDto.email,
      passwordHash: 'hashed_password',
      fullName: 'Test User',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it('should login successfully and return token', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(user);
      (argon2.verify as jest.Mock).mockResolvedValue(true);
      jwtService.sign.mockReturnValue('mock_access_token');

      const result = await service.login(loginDto);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: loginDto.email },
      });
      expect(argon2.verify).toHaveBeenCalledWith(
        user.passwordHash,
        loginDto.password,
      );
      expect(result).toEqual({
        accessToken: 'mock_access_token',
        user: {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
        },
      });
    });

    it('should throw UnauthorizedException if user not found', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.login(loginDto)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException if password does not match', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(user);
      (argon2.verify as jest.Mock).mockResolvedValue(false);

      await expect(service.login(loginDto)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });
});
