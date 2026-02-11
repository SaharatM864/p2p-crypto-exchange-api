import { Test, TestingModule } from '@nestjs/testing';
import { TradesService } from './trades.service';
import { PrismaService } from '../prisma/prisma.service';
import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import {
  Prisma,
  TradeStatus,
  OrderSide,
  OrderStatus,
  Trade,
  Wallet,
} from '@prisma/client';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';

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

      prisma.order.findUnique.mockResolvedValue(
        order as Parameters<
          typeof prisma.order.findUnique.mockResolvedValue
        >[0],
      );

      (prisma.$transaction as jest.Mock).mockImplementation(
        (callback: (prisma: any) => Promise<any>) => callback(prisma),
      );

      // Mock finding order again in transaction
      prisma.order.findUnique.mockResolvedValue(
        order as Parameters<
          typeof prisma.order.findUnique.mockResolvedValue
        >[0],
      );

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

      prisma.trade.create.mockResolvedValue(createdTrade as unknown as Trade);

      // Mock order update
      prisma.order.update.mockResolvedValue({
        ...order,
        filledAmount: new Prisma.Decimal(0.5),
        status: OrderStatus.PARTIAL,
      } as Parameters<typeof prisma.order.update.mockResolvedValue>[0]);

      const result = await service.create(userId, { orderId, amount });

      expect(result).toEqual(createdTrade);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(prisma.trade.create).toHaveBeenCalled();
      // eslint-disable-next-line @typescript-eslint/unbound-method
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
      (prisma.$transaction as jest.Mock).mockImplementation(
        (callback: (prisma: any) => Promise<any>) => callback(prisma),
      );
      prisma.$executeRaw.mockResolvedValue(1);
      prisma.order.findUnique.mockResolvedValue(
        order as Parameters<
          typeof prisma.order.findUnique.mockResolvedValue
        >[0],
      );

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

      (prisma.$transaction as jest.Mock).mockImplementation(
        (callback: (prisma: any) => Promise<any>) => callback(prisma),
      );
      prisma.$executeRaw.mockResolvedValue(1);

      prisma.order.findUnique.mockResolvedValue(
        order as Parameters<
          typeof prisma.order.findUnique.mockResolvedValue
        >[0],
      );

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

      (prisma.$transaction as jest.Mock).mockImplementation(
        (callback: (prisma: any) => Promise<any>) => callback(prisma),
      );
      prisma.$executeRaw.mockResolvedValue(1);

      prisma.trade.findUnique.mockResolvedValue(
        trade as Parameters<
          typeof prisma.trade.findUnique.mockResolvedValue
        >[0],
      );

      const updatedTrade = { ...trade, status: TradeStatus.PAID };
      prisma.trade.update.mockResolvedValue(
        updatedTrade as Parameters<
          typeof prisma.trade.update.mockResolvedValue
        >[0],
      );

      const result = await service.markPaid(userId, tradeId);

      expect(result.status).toBe(TradeStatus.PAID);
      // eslint-disable-next-line @typescript-eslint/unbound-method
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

      (prisma.$transaction as jest.Mock).mockImplementation(
        (callback: (prisma: any) => Promise<any>) => callback(prisma),
      );
      prisma.$executeRaw.mockResolvedValue(1);
      prisma.trade.findUnique.mockResolvedValue(
        trade as Parameters<
          typeof prisma.trade.findUnique.mockResolvedValue
        >[0],
      );

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

      prisma.trade.findUnique.mockResolvedValue(trade as unknown as Trade);

      (prisma.$transaction as jest.Mock).mockImplementation(
        (callback: (prisma: any) => Promise<any>) => callback(prisma),
      );

      prisma.trade.findUnique.mockResolvedValue(trade as unknown as Trade);

      // Mock finding system fee user
      prisma.user.findUnique.mockResolvedValue({
        id: 'fee-user-id',
      } as Parameters<typeof prisma.user.findUnique.mockResolvedValue>[0]);

      // Mock finding wallets
      // Better to use a mock that behaves like Decimal if possible
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

      prisma.wallet.findUnique.mockResolvedValue(
        walletWithDecimal as unknown as Wallet,
      );

      // Mock executeRaw for locks
      prisma.$executeRaw.mockResolvedValue(1);

      // Mocks for ledger updates...
      prisma.wallet.update.mockResolvedValue(
        {} as Parameters<typeof prisma.wallet.update.mockResolvedValue>[0],
      );
      // Mock transaction create!
      prisma.transaction.create.mockResolvedValue({
        id: 'tx-release',
      } as Parameters<typeof prisma.transaction.create.mockResolvedValue>[0]);
      prisma.ledgerEntry.create.mockResolvedValue({
        id: 'entry-release',
      } as Parameters<typeof prisma.ledgerEntry.create.mockResolvedValue>[0]);

      prisma.trade.update.mockResolvedValue({
        ...trade,
        status: TradeStatus.COMPLETED,
      } as unknown as Trade);
      prisma.order.update.mockResolvedValue(
        {} as Parameters<typeof prisma.order.update.mockResolvedValue>[0],
      );

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

      (prisma.$transaction as jest.Mock).mockImplementation(
        (callback: (prisma: any) => Promise<any>) => callback(prisma),
      );
      prisma.trade.findUnique.mockResolvedValue(
        trade as Parameters<
          typeof prisma.trade.findUnique.mockResolvedValue
        >[0],
      );

      await expect(service.release(userId, tradeId)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('cancel', () => {
    it('should cancel trade successfully by buyer', async () => {
      const tradeId = 'trade-1';
      const userId = 'buyer-1';

      const trade = {
        id: tradeId,
        buyerId: userId,
        sellerId: 'seller-1',
        orderId: 'order-1',
        status: TradeStatus.PENDING_PAYMENT,
        amount: new Prisma.Decimal(100),
        cryptoAmount: new Prisma.Decimal(1),
        fee: new Prisma.Decimal(0),
        order: {
          id: 'order-1',
          type: OrderSide.SELL,
          filledAmount: new Prisma.Decimal(0.5),
        },
      };

      const wallet = {
        id: 'wallet-seller',
        userId: 'seller-1',
        availableBalance: new Prisma.Decimal(0),
        lockedBalance: new Prisma.Decimal(1.001),
      };

      prisma.trade.findUnique.mockResolvedValue(trade as unknown as Trade);

      (prisma.$transaction as jest.Mock).mockImplementation(
        (callback: (prisma: any) => Promise<any>) => callback(prisma),
      );
      // Mock re-fetch inside transaction
      prisma.trade.findUnique.mockResolvedValue(trade as unknown as Trade);

      prisma.wallet.findFirst.mockResolvedValue(
        wallet as Parameters<
          typeof prisma.wallet.findFirst.mockResolvedValue
        >[0],
      );
      prisma.wallet.update.mockResolvedValue(
        wallet as Parameters<typeof prisma.wallet.update.mockResolvedValue>[0],
      );
      prisma.trade.update.mockResolvedValue({
        ...trade,
        status: TradeStatus.CANCELLED,
      } as unknown as Trade);
      prisma.order.update.mockResolvedValue(
        {} as Parameters<typeof prisma.order.update.mockResolvedValue>[0],
      );
      prisma.order.findUnique.mockResolvedValue({
        id: 'order-1',
        filledAmount: new Prisma.Decimal(0.5),
      } as Parameters<typeof prisma.order.findUnique.mockResolvedValue>[0]);

      const result = await service.cancel(userId, tradeId);

      expect(result.status).toBe(TradeStatus.CANCELLED);
      // specific check: order filled amount restored
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(prisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: trade.orderId },
          data: expect.objectContaining({
            filledAmount: new Prisma.Decimal(-0.5),
          }) as Record<string, unknown>,
        }),
      );
    });

    it('should fail if trade already completed', async () => {
      const tradeId = 'trade-1';
      const userId = 'buyer-1';
      const trade = {
        id: tradeId,
        buyerId: userId,
        status: TradeStatus.COMPLETED,
      };

      prisma.trade.findUnique.mockResolvedValue(
        trade as Parameters<
          typeof prisma.trade.findUnique.mockResolvedValue
        >[0],
      );
      (prisma.$transaction as jest.Mock).mockImplementation(
        (callback: (prisma: any) => Promise<any>) => callback(prisma),
      );
      // Mock re-fetch
      prisma.trade.findUnique.mockResolvedValue(
        trade as Parameters<
          typeof prisma.trade.findUnique.mockResolvedValue
        >[0],
      );

      await expect(service.cancel(userId, tradeId)).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
