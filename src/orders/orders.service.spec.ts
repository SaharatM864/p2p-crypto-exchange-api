import { Test, TestingModule } from '@nestjs/testing';
import { OrdersService } from './orders.service';
import { PrismaService } from '../prisma/prisma.service';
import { mockDeep, DeepMockProxy, mockReset } from 'jest-mock-extended';
import { Prisma, OrderSide, OrderStatus, CurrencyType } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';
import { TRADING_FEE_RATE } from '../common/constants/fee.constants';

describe('OrdersService', () => {
  let service: OrdersService;
  let prisma: DeepMockProxy<PrismaService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        {
          provide: PrismaService,
          useFactory: () => mockDeep<PrismaService>(),
        },
      ],
    }).compile();

    service = module.get<OrdersService>(OrdersService);
    prisma = module.get(PrismaService);
    mockReset(prisma);
    // Mock transaction for all tests
    (prisma.$transaction as jest.Mock).mockImplementation(
      (callback: (prisma: any) => Promise<any>) => callback(prisma),
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    const createOrderDto = {
      side: OrderSide.SELL,
      cryptoCurrency: 'BTC',
      fiatCurrency: 'THB',
      price: 1000000, // 1 BTC = 1,000,000 THB
      totalAmount: 1, // Sell 1 BTC
      minLimit: 1000,
      maxLimit: 1000000,
    };

    const userId = 'user-123';

    it('should create a SELL order and lock balance', async () => {
      // Setup mocks
      const feeRate = new Prisma.Decimal(TRADING_FEE_RATE); // 0.001
      const totalAmount = new Prisma.Decimal(createOrderDto.totalAmount);
      const lockAmount = totalAmount.mul(new Prisma.Decimal(1).plus(feeRate)); // 1.001 BTC

      // Mock currency validation
      (prisma.currency.findUnique as jest.Mock).mockImplementation(
        (args: { where: { code: string } }) => {
          if (args.where.code === 'BTC') {
            return Promise.resolve({
              code: 'BTC',
              name: 'Bitcoin',
              type: CurrencyType.CRYPTO,
              decimalPlaces: 8,
              isActive: true,
              createdAt: new Date(),
            });
          }
          if (args.where.code === 'THB') {
            return Promise.resolve({
              code: 'THB',
              name: 'Thai Baht',
              type: CurrencyType.FIAT,
              decimalPlaces: 2,
              isActive: true,
              createdAt: new Date(),
            });
          }
          return Promise.resolve(null);
        },
      );

      // Mock wallet check
      (prisma.wallet.findUnique as jest.Mock).mockResolvedValue({
        id: 'wallet-btc',
        userId,
        currencyCode: 'BTC',
        availableBalance: new Prisma.Decimal(2.0),
        lockedBalance: new Prisma.Decimal(0),
        pendingBalance: new Prisma.Decimal(0),
        status: 'ACTIVE',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Mock update wallet (lock funds)
      (prisma.wallet.update as jest.Mock).mockResolvedValue({
        id: 'wallet-btc',
        userId,
        currencyCode: 'BTC',
        availableBalance: new Prisma.Decimal(2.0).minus(lockAmount),
        lockedBalance: lockAmount,
        pendingBalance: new Prisma.Decimal(0),
        status: 'ACTIVE',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Mock transaction and ledger
      (prisma.transaction.create as jest.Mock).mockResolvedValue({
        id: 'tx-1',
      } as any);
      (prisma.ledgerEntry.create as jest.Mock).mockResolvedValue({
        id: 'entry-1',
      } as any);

      // Mock create order
      const createdOrder = {
        id: 'order-1',
        userId,
        ...createOrderDto,
        price: new Prisma.Decimal(createOrderDto.price),
        totalAmount: new Prisma.Decimal(createOrderDto.totalAmount),
        filledAmount: new Prisma.Decimal(0),
        minLimit: new Prisma.Decimal(createOrderDto.minLimit),
        maxLimit: new Prisma.Decimal(createOrderDto.maxLimit),
        status: OrderStatus.OPEN,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (prisma.order.create as jest.Mock).mockResolvedValue(createdOrder);

      // Execute
      const result = await service.create(userId, createOrderDto);

      // Assert
      expect(result).toEqual(createdOrder);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(prisma.wallet.update).toHaveBeenCalledWith({
        where: {
          id: 'wallet-btc',
        },
        data: {
          availableBalance: { decrement: lockAmount },
          lockedBalance: { increment: lockAmount },
        },
      });
    });

    it('should throw error if insufficient balance for SELL order', async () => {
      // Mock currency validation
      (prisma.currency.findUnique as jest.Mock).mockImplementation(
        (args: { where: { code: string } }) => {
          if (args.where.code === 'BTC') {
            return Promise.resolve({
              code: 'BTC',
              name: 'Bitcoin',
              type: CurrencyType.CRYPTO,
              decimalPlaces: 8,
              isActive: true,
              createdAt: new Date(),
            });
          }
          if (args.where.code === 'THB') {
            return Promise.resolve({
              code: 'THB',
              name: 'Thai Baht',
              type: CurrencyType.FIAT,
              decimalPlaces: 2,
              isActive: true,
              createdAt: new Date(),
            });
          }
          return Promise.resolve(null);
        },
      );

      // Mock wallet with insufficient balance
      (prisma.wallet.findUnique as jest.Mock).mockImplementation(
        (args: {
          where: {
            id?: string;
            userId_currencyCode?: { userId: string; currencyCode: string };
          };
        }) => {
          if (
            args.where.id === 'wallet-btc-insufficient' ||
            args.where.userId_currencyCode
          ) {
            return Promise.resolve({
              id: 'wallet-btc-insufficient',
              userId,
              currencyCode: 'BTC',
              availableBalance: new Prisma.Decimal(0), // Definitely < 1.001
              lockedBalance: new Prisma.Decimal(0),
              pendingBalance: new Prisma.Decimal(0),
              status: 'ACTIVE',
              createdAt: new Date(),
              updatedAt: new Date(),
            });
          }
          return Promise.resolve(null);
        },
      );

      // Mock transaction/ledger to ensure no crash if logic proceeds (which it shouldn't)
      (prisma.transaction.create as jest.Mock).mockResolvedValue({
        id: 'tx-2',
      } as any);
      (prisma.ledgerEntry.create as jest.Mock).mockResolvedValue({
        id: 'entry-2',
      } as any);
      (prisma.wallet.update as jest.Mock).mockResolvedValue({} as any);
      (prisma.order.create as jest.Mock).mockResolvedValue({
        id: 'order-fail',
      } as any);

      // Execute & Assert
      await expect(service.create(userId, createOrderDto)).rejects.toThrow(
        new BadRequestException('Insufficient balance to cover order + fee'),
      );
    });
    it('should create a BUY order without locking balance', async () => {
      const buyOrderDto = { ...createOrderDto, side: OrderSide.BUY };

      // Mock currency validation
      (prisma.currency.findUnique as jest.Mock).mockImplementation(
        (args: { where: { code: string } }) => {
          if (args.where.code === 'BTC')
            return Promise.resolve({
              code: 'BTC',
              type: CurrencyType.CRYPTO,
              decimalPlaces: 8,
              isActive: true,
            });
          if (args.where.code === 'THB')
            return Promise.resolve({
              code: 'THB',
              type: CurrencyType.FIAT,
              decimalPlaces: 2,
              isActive: true,
            });
          return Promise.resolve(null);
        },
      );

      // Mock Wallet
      (prisma.wallet.findUnique as jest.Mock).mockResolvedValue({
        id: 'wallet-thb',
        userId,
        currencyCode: 'THB',
        availableBalance: new Prisma.Decimal(10000000),
        lockedBalance: new Prisma.Decimal(0),
      } as any);

      // Mock Order creation
      const createdOrder = {
        id: 'order-buy-1',
        userId,
        ...buyOrderDto,
        price: new Prisma.Decimal(buyOrderDto.price),
        totalAmount: new Prisma.Decimal(buyOrderDto.totalAmount),
        filledAmount: new Prisma.Decimal(0),
        status: OrderStatus.OPEN,
      };
      (prisma.order.create as jest.Mock).mockResolvedValue(createdOrder as any);

      const result = await service.create(userId, buyOrderDto);

      expect(result).toEqual(createdOrder);
      // Ensure NO wallet update (lock) is called for BUY order
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(prisma.wallet.update).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException if currency is invalid', async () => {
      (prisma.currency.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.create(userId, createOrderDto)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('findAll', () => {
    it('should return orders', async () => {
      const orders = [
        { id: 'order-1', status: OrderStatus.OPEN },
        { id: 'order-2', status: OrderStatus.OPEN },
      ];

      (prisma.order.findMany as jest.Mock).mockResolvedValue(orders as any);

      const result = await service.findAll();

      expect(result).toEqual(orders);
    });
  });
});
