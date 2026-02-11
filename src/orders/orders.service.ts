import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderSide, Prisma } from '@prisma/client';
import { TRADING_FEE_RATE } from '../common/constants/fee.constants';

@Injectable()
export class OrdersService {
  constructor(private prisma: PrismaService) {}

  async create(userId: string, dto: CreateOrderDto) {
    return this.prisma.$transaction(async (tx) => {
      const crypto = await tx.currency.findUnique({
        where: { code: dto.cryptoCurrency },
      });
      if (!crypto || crypto.type !== 'CRYPTO')
        throw new BadRequestException('Invalid crypto currency');

      const fiat = await tx.currency.findUnique({
        where: { code: dto.fiatCurrency },
      });
      if (!fiat || fiat.type !== 'FIAT')
        throw new BadRequestException('Invalid fiat currency');

      if (dto.side === OrderSide.SELL) {
        const totalAmountDecimal = new Prisma.Decimal(dto.totalAmount);
        const feeRateDecimal = new Prisma.Decimal(TRADING_FEE_RATE);
        const lockAmount = totalAmountDecimal.mul(
          new Prisma.Decimal(1).plus(feeRateDecimal),
        );

        const walletToLock = await tx.wallet.findUnique({
          where: {
            userId_currencyCode: {
              userId,
              currencyCode: dto.cryptoCurrency,
            },
          },
          select: { id: true },
        });

        if (!walletToLock) throw new BadRequestException('Wallet not found');

        await tx.$executeRaw(
          Prisma.sql`SELECT * FROM wallets WHERE id = ${walletToLock.id} FOR UPDATE`,
        );

        const wallet = await tx.wallet.findUnique({
          where: { id: walletToLock.id },
        });

        if (!wallet) throw new BadRequestException('Wallet not found');

        if (wallet.availableBalance.lessThan(lockAmount)) {
          throw new BadRequestException(
            'Insufficient balance to cover order + fee',
          );
        }

        await tx.wallet.update({
          where: { id: wallet.id },
          data: {
            availableBalance: { decrement: lockAmount },
            lockedBalance: { increment: lockAmount },
          },
        });

        const lockTx = await tx.transaction.create({
          data: {
            type: 'TRADE',
            status: 'POSTED',
            description: `Order escrow lock — ${dto.totalAmount} ${dto.cryptoCurrency}`,
          },
        });

        await tx.ledgerEntry.create({
          data: {
            transactionId: lockTx.id,
            walletId: wallet.id,
            amount: lockAmount.negated(),
            balanceAfter: wallet.availableBalance.minus(lockAmount),
            entryType: 'DEBIT',
          },
        });
      }

      const order = await tx.order.create({
        data: {
          userId,
          side: dto.side,
          cryptoCurrency: dto.cryptoCurrency,
          fiatCurrency: dto.fiatCurrency,
          price: dto.price,
          totalAmount: dto.totalAmount,
          minLimit: dto.minLimit,
          maxLimit: dto.maxLimit,
          status: 'OPEN',
        },
      });

      return order;
    });
  }

  async findAll() {
    return this.prisma.order.findMany({
      where: {
        status: { in: ['OPEN', 'PARTIAL'] },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
