import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import * as argon2 from 'argon2';
import { JwtService } from '@nestjs/jwt';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async register(registerDto: RegisterDto) {
    // 1. Check if email exists
    const existingUser = await this.prisma.user.findUnique({
      where: { email: registerDto.email },
    });

    if (existingUser) {
      throw new ConflictException('Email already exists');
    }

    // 2. Hash password
    const passwordHash = await argon2.hash(registerDto.password);

    // 3. Create user + wallets in transaction
    // Default currencies to create wallets for
    const defaultCurrencies = ['BTC', 'ETH', 'USDT', 'THB', 'USD'];

    // Verify currencies exist first to avoid errors (optional but good practice)
    // For this exam, we assume seed data is there.

    try {
      const user = await this.prisma.user.create({
        data: {
          email: registerDto.email,
          passwordHash,
          fullName: registerDto.fullName,
          status: 'ACTIVE', // Auto activate for demo
          wallets: {
            create: defaultCurrencies.map((code) => ({
              currencyCode: code,
            })),
          },
        },
        include: {
          wallets: true,
        },
      });

      // Exclude password hash from response
      // Exclude password hash from response
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { passwordHash: _ph, ...result } = user;
      return result;
    } catch {
      // Handle case where currency might not exist if seed didn't run
      // causing FK constraint error on wallet creation
      throw new BadRequestException(
        'Failed to register user. System might not be initialized properly.',
      );
    }
  }

  async login(loginDto: LoginDto) {
    // 1. Find user
    const user = await this.prisma.user.findUnique({
      where: { email: loginDto.email },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // 2. Verify password
    const isPasswordValid = await argon2.verify(
      user.passwordHash,
      loginDto.password,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // 3. Generate JWT
    const payload = { sub: user.id, email: user.email };

    return {
      accessToken: this.jwtService.sign(payload),
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
      },
    };
  }
}
