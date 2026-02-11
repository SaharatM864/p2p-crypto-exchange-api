import { Test, TestingModule } from '@nestjs/testing';
import { WalletsService } from './wallets.service';
import { PrismaService } from '../prisma/prisma.service';
import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import { Prisma, WalletStatus, CurrencyType, Wallet } from '@prisma/client';

describe('WalletsService', () => {
  let service: WalletsService;
  let prisma: DeepMockProxy<PrismaService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WalletsService,
        {
          provide: PrismaService,
          useFactory: () => mockDeep<PrismaService>(),
        },
      ],
    }).compile();

    service = module.get<WalletsService>(WalletsService);
    prisma = module.get(PrismaService);
  });

  describe('getMyWallets', () => {
    it('should return list of user wallets with calculated totals', async () => {
      const userId = 'user-1';

      const wallets = [
        {
          id: 'wallet-1',
          userId,
          currencyCode: 'BTC',
          availableBalance: new Prisma.Decimal(1.0),
          lockedBalance: new Prisma.Decimal(0.5),
          pendingBalance: new Prisma.Decimal(0),
          status: WalletStatus.ACTIVE,
          currency: {
            code: 'BTC',
            name: 'Bitcoin',
            type: CurrencyType.CRYPTO,
          },
        },
      ];

      prisma.wallet.findMany.mockResolvedValue(wallets as unknown as Wallet[]);

      const result = await service.getMyWallets(userId);

      expect(result).toHaveLength(1);
      expect(result[0].currencyCode).toBe('BTC');
      expect(result[0].availableBalance).toBe('1');
      expect(result[0].totalBalance).toBe('1.5'); // 1.0 + 0.5 + 0
    });

    it('should return empty list if no wallets found', async () => {
      prisma.wallet.findMany.mockResolvedValue([]);
      const result = await service.getMyWallets('user-x');
      expect(result).toEqual([]);
    });
  });
});
