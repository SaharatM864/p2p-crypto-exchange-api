import { Test, TestingModule } from '@nestjs/testing';
import { TradesService } from './trades.service';
import { PrismaService } from '../prisma/prisma.service';
import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import { Prisma, TradeStatus, OrderSide, OrderStatus } from '@prisma/client';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { TRADING_FEE_RATE } from '../common/constants/fee.constants';

describe('TradesService', () => {
  let service: TradesService;
  let prisma: DeepMockProxy<PrismaService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TradesService,
        {
          provide: PrismaService,
          useFactory: () => mockDeep<PrismaService>(),
        },
      ],
    }).compile();

    service = module.get<TradesService>(TradesService);
    prisma = module.get(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create a trade successfully', async () => {
      const orderId = 'order-1';
      const userId = 'buyer-1'; // Current user is buyer
      const amount = 0.5;

      // Mock Order
      const order = {
        id: orderId,
        userId: 'seller-1',
        side: OrderSide.SELL,
        cryptoCurrency: 'BTC',
        fiatCurrency: 'THB',
        price: new Prisma.Decimal(1000000),
        totalAmount: new Prisma.Decimal(1.0),
        filledAmount: new Prisma.Decimal(0),
        minLimit: new Prisma.Decimal(100),
        maxLimit: new Prisma.Decimal(1000000),
        status: OrderStatus.OPEN,
      };

      prisma.order.findUnique.mockResolvedValue(order as any);

      prisma.$transaction.mockImplementation(async (callback: any) => {
        return callback(prisma);
      });

      // Mock finding order again in transaction
      prisma.order.findUnique.mockResolvedValue(order as any);

      // Mock executeRaw
      prisma.$executeRaw.mockResolvedValue(1);

      // Mock trade creation response
      const createdTrade = {
        id: 'trade-1',
        orderId,
        buyerId: userId,
        sellerId: 'seller-1',
        cryptoAmount: new Prisma.Decimal(amount),
        fiatAmount: new Prisma.Decimal(500000), // 0.5 * 1,000,000
        price: new Prisma.Decimal(1000000),
        status: TradeStatus.PENDING_PAYMENT,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      prisma.trade.create.mockResolvedValue(createdTrade as any);

      // Mock order update
      prisma.order.update.mockResolvedValue({
        ...order,
        filledAmount: new Prisma.Decimal(0.5),
        status: OrderStatus.PARTIAL,
      } as any);

      const result = await service.create(userId, { orderId, amount });

      expect(result).toEqual(createdTrade);
      expect(prisma.trade.create).toHaveBeenCalled();
      expect(prisma.order.update).toHaveBeenCalled();
    });

    it('should throw error if trading with own order', async () => {
      const orderId = 'order-1';
      const userId = 'seller-1'; // Same as seller

      const order = {
        id: orderId,
        userId: 'seller-1',
        status: OrderStatus.OPEN,
        totalAmount: new Prisma.Decimal(1),
        filledAmount: new Prisma.Decimal(0),
      };

      // Ensure proper mocking for transaction flow
      prisma.$transaction.mockImplementation(async (callback: any) => {
        return callback(prisma);
      });
      prisma.$executeRaw.mockResolvedValue(1);
      prisma.order.findUnique.mockResolvedValue(order as any);

      await expect(
        service.create(userId, { orderId, amount: 0.5 }),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw error if insufficient order amount', async () => {
      const orderId = 'order-1';
      const userId = 'buyer-1';

      // Set status to PARTIAL so it passes the first check ("Order is not available")
      const order = {
        id: orderId,
        userId: 'seller-1',
        status: OrderStatus.PARTIAL,
        totalAmount: new Prisma.Decimal(1.0),
        filledAmount: new Prisma.Decimal(1.0), // FULL
        price: new Prisma.Decimal(100),
      };

      prisma.$transaction.mockImplementation(async (callback: any) => {
        return callback(prisma);
      });
      prisma.$executeRaw.mockResolvedValue(1);

      prisma.order.findUnique.mockResolvedValue(order as any);

      await expect(
        service.create(userId, { orderId, amount: 0.1 }),
      ).rejects.toThrow('Insufficient amount in order');
    });
  });

  describe('markPaid', () => {
    it('should mark trade as PAID', async () => {
      const tradeId = 'trade-1';
      const userId = 'buyer-1';

      const trade = {
        id: tradeId,
        buyerId: userId,
        status: TradeStatus.PENDING_PAYMENT,
      };

      prisma.$transaction.mockImplementation(async (callback: any) => {
        return callback(prisma);
      });
      prisma.$executeRaw.mockResolvedValue(1);

      prisma.trade.findUnique.mockResolvedValue(trade as any);

      const updatedTrade = { ...trade, status: TradeStatus.PAID };
      prisma.trade.update.mockResolvedValue(updatedTrade as any);

      const result = await service.markPaid(userId, tradeId);

      expect(result.status).toBe(TradeStatus.PAID);
      expect(prisma.trade.update).toHaveBeenCalledWith({
        where: { id: tradeId },
        data: { status: TradeStatus.PAID },
      });
    });

    it('should throw error if not buyer', async () => {
      const tradeId = 'trade-1';
      const userId = 'other-user';

      const trade = {
        id: tradeId,
        buyerId: 'buyer-1',
        status: TradeStatus.PENDING_PAYMENT,
      };

      prisma.$transaction.mockImplementation(async (callback: any) => {
        return callback(prisma);
      });
      prisma.$executeRaw.mockResolvedValue(1);
      prisma.trade.findUnique.mockResolvedValue(trade as any);

      await expect(service.markPaid(userId, tradeId)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('release', () => {
    it('should release crypto and update balances', async () => {
      const tradeId = 'trade-1';
      const userId = 'seller-1';

      const trade = {
        id: tradeId,
        sellerId: userId,
        buyerId: 'buyer-1',
        status: TradeStatus.PAID,
        order: { cryptoCurrency: 'BTC' },
        cryptoAmount: new Prisma.Decimal(1.0),
      };

      prisma.trade.findUnique.mockResolvedValue(trade as any);

      prisma.$transaction.mockImplementation(async (callback: any) => {
        return callback(prisma);
      });

      // Re-fetch in transaction
      prisma.trade.findUnique.mockResolvedValue(trade as any);

      // Mock finding system fee user
      prisma.user.findUnique.mockResolvedValue({ id: 'fee-user-id' } as any);

      // Mock finding wallets
      const walletMock = {
        id: 'wallet-id',
        availableBalance: new Prisma.Decimal(10),
        lockedBalance: new Prisma.Decimal(10),
        // Mock methods for calculation if needed, but Decimal arithmetic usually needs real Decimal or good mock
        // Since we are not asserting calculations strictly here, simple object might suffice unless service calls methods.
        // Service calls `availableBalance.plus(...)` etc.
        // So we need real Decimal or mock.
      };
      // Better to use a mock that behaves like Decimal if possible, or cast real Decimal
      // But here we rely on service just calling update with calculated values.
      // Wait, service uses `wallet.lockedBalance.minus(...)`.
      // So the returned object MUST have `minus` method.
      const decimalMock = {
        plus: jest.fn().mockReturnThis(),
        minus: jest.fn().mockReturnThis(),
        negated: jest.fn().mockReturnThis(),
        equals: jest.fn().mockReturnValue(true),
        greaterThan: jest.fn().mockReturnValue(true),
        lessThan: jest.fn().mockReturnValue(false),
      };

      // Inject decimal mock into wallet
      const walletWithDecimal = {
        id: 'wallet-id',
        availableBalance: decimalMock,
        lockedBalance: decimalMock,
      };

      prisma.wallet.findUnique.mockResolvedValue(walletWithDecimal as any);

      // Mock executeRaw for locks
      prisma.$executeRaw.mockResolvedValue(1);

      // Mocks for ledger updates...
      prisma.wallet.update.mockResolvedValue({} as any);
      // Mock transaction create!
      prisma.transaction.create.mockResolvedValue({ id: 'tx-release' } as any);
      prisma.ledgerEntry.create.mockResolvedValue({
        id: 'entry-release',
      } as any);

      prisma.trade.update.mockResolvedValue({
        ...trade,
        status: TradeStatus.COMPLETED,
      } as any);
      prisma.order.update.mockResolvedValue({} as any);

      const result = await service.release(userId, tradeId);

      expect(result.status).toBe(TradeStatus.COMPLETED);
    });

    it('should throw error if trade not PAID', async () => {
      const tradeId = 'trade-1';
      const userId = 'seller-1';

      const trade = {
        id: tradeId,
        sellerId: userId,
        status: TradeStatus.PENDING_PAYMENT,
      };

      prisma.$transaction.mockImplementation(async (callback: any) => {
        return callback(prisma);
      });
      prisma.trade.findUnique.mockResolvedValue(trade as any);

      await expect(service.release(userId, tradeId)).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
