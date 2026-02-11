import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTradeDto } from './dto/create-trade.dto';
import { Prisma } from '@prisma/client';
import { TRADING_FEE_RATE } from '../common/constants/fee.constants';

@Injectable()
export class TradesService {
  constructor(private prisma: PrismaService) {}

  async create(userId: string, dto: CreateTradeDto) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT * FROM orders WHERE id = ${dto.orderId} FOR UPDATE`;

      const order = await tx.order.findUnique({
        where: { id: dto.orderId },
        include: { user: true },
      });

      if (!order) throw new NotFoundException('Order not found');

      if (order.status !== 'OPEN' && order.status !== 'PARTIAL') {
        throw new ConflictException('Order is not available');
      }

      if (order.userId === userId) {
        throw new ConflictException('Cannot trade with your own order');
      }

      const tradeAmount = new Prisma.Decimal(dto.amount);
      const remainingAmount = order.totalAmount.minus(order.filledAmount);

      if (tradeAmount.greaterThan(remainingAmount)) {
        throw new BadRequestException('Insufficient amount in order');
      }

      const isBuyOrder = order.side === 'BUY';

      const buyerId = isBuyOrder ? order.userId : userId;
      const sellerId = isBuyOrder ? userId : order.userId;

      const fiatAmount = tradeAmount.mul(order.price);

      const trade = await tx.trade.create({
        data: {
          orderId: order.id,
          buyerId,
          sellerId,
          cryptoAmount: tradeAmount,
          fiatAmount: fiatAmount,
          price: order.price,
          status: 'PENDING_PAYMENT',
        },
      });

      const newFilled = order.filledAmount.plus(tradeAmount);
      const isCompleted = newFilled.equals(order.totalAmount);

      await tx.order.update({
        where: { id: order.id },
        data: {
          filledAmount: newFilled,
          status: isCompleted ? 'COMPLETED' : 'PARTIAL',
        },
      });

      return trade;
    });
  }

  async markPaid(userId: string, tradeId: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT * FROM trades WHERE id = ${tradeId} FOR UPDATE`;

      const trade = await tx.trade.findUnique({
        where: { id: tradeId },
      });

      if (!trade) throw new NotFoundException('Trade not found');
      if (trade.buyerId !== userId)
        throw new ForbiddenException('Only buyer can mark as paid');
      if (trade.status !== 'PENDING_PAYMENT')
        throw new BadRequestException('Invalid trade status');

      return tx.trade.update({
        where: { id: tradeId },
        data: { status: 'PAID' },
      });
    });
  }

  async release(userId: string, tradeId: string) {
    return this.prisma.$transaction(async (tx) => {
      const trade = await tx.trade.findUnique({
        where: { id: tradeId },
        include: { order: true },
      });

      if (!trade) throw new NotFoundException('Trade not found');
      if (trade.sellerId !== userId)
        throw new ForbiddenException('Only seller can release');
      if (trade.status !== 'PAID')
        throw new BadRequestException('Trade must be PAID first');

      const systemFeeUser = await tx.user.findUnique({
        where: { email: 'fees@p2p.com' },
      });

      if (!systemFeeUser) throw new Error('System Fee User not found');

      const cryptoCode = trade.order.cryptoCurrency;

      const sellerWalletId = (
        await tx.wallet.findUnique({
          where: {
            userId_currencyCode: {
              userId: trade.sellerId,
              currencyCode: cryptoCode,
            },
          },
          select: { id: true },
        })
      )?.id;

      const buyerWalletId = (
        await tx.wallet.findUnique({
          where: {
            userId_currencyCode: {
              userId: trade.buyerId,
              currencyCode: cryptoCode,
            },
          },
          select: { id: true },
        })
      )?.id;

      const systemFeeWalletId = (
        await tx.wallet.findUnique({
          where: {
            userId_currencyCode: {
              userId: systemFeeUser.id,
              currencyCode: cryptoCode,
            },
          },
          select: { id: true },
        })
      )?.id;

      if (!sellerWalletId || !buyerWalletId || !systemFeeWalletId)
        throw new BadRequestException('Wallets not found');

      await tx.$executeRaw`SELECT * FROM wallets WHERE id IN (${sellerWalletId}, ${buyerWalletId}, ${systemFeeWalletId}) FOR UPDATE`;

      const sellerWallet = await tx.wallet.findUnique({
        where: { id: sellerWalletId },
      });
      const buyerWallet = await tx.wallet.findUnique({
        where: { id: buyerWalletId },
      });
      const systemFeeWallet = await tx.wallet.findUnique({
        where: { id: systemFeeWalletId },
      });

      if (!sellerWallet || !buyerWallet || !systemFeeWallet)
        throw new BadRequestException('Wallets not found after lock');

      // Calculate logic
      const tradeAmount = trade.cryptoAmount;
      const feeRate = new Prisma.Decimal(TRADING_FEE_RATE);
      const feeAmount = tradeAmount.mul(feeRate);
      const totalDeductFromSeller = tradeAmount.plus(feeAmount);

      const ledgerSum = totalDeductFromSeller
        .negated()
        .plus(tradeAmount)
        .plus(feeAmount);
      if (!ledgerSum.equals(new Prisma.Decimal(0))) {
        throw new Error(
          `Zero-sum validation failed: sum=${ledgerSum.toString()}`,
        );
      }

      await tx.wallet.update({
        where: { id: sellerWallet.id },
        data: { lockedBalance: { decrement: totalDeductFromSeller } },
      });

      await tx.wallet.update({
        where: { id: buyerWallet.id },
        data: { availableBalance: { increment: tradeAmount } },
      });

      await tx.wallet.update({
        where: { id: systemFeeWallet.id },
        data: { availableBalance: { increment: feeAmount } },
      });

      const transaction = await tx.transaction.create({
        data: {
          type: 'TRADE',
          status: 'POSTED',
          description: `Trade ${trade.id} release`,
        },
      });

      await tx.ledgerEntry.create({
        data: {
          transactionId: transaction.id,
          walletId: sellerWallet.id,
          amount: totalDeductFromSeller.negated(),
          balanceAfter: sellerWallet.lockedBalance.minus(totalDeductFromSeller),
          entryType: 'DEBIT',
        },
      });

      await tx.ledgerEntry.create({
        data: {
          transactionId: transaction.id,
          walletId: buyerWallet.id,
          amount: tradeAmount,
          balanceAfter: buyerWallet.availableBalance.plus(tradeAmount),
          entryType: 'CREDIT',
        },
      });

      await tx.ledgerEntry.create({
        data: {
          transactionId: transaction.id,
          walletId: systemFeeWallet.id,
          amount: feeAmount,
          balanceAfter: systemFeeWallet.availableBalance.plus(feeAmount),
          entryType: 'CREDIT',
        },
      });

      return tx.trade.update({
        where: { id: tradeId },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
        },
      });
    });
  }

  async cancel(userId: string, tradeId: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT * FROM trades WHERE id = ${tradeId} FOR UPDATE`;

      const trade = await tx.trade.findUnique({
        where: { id: tradeId },
        include: { order: true },
      });

      if (!trade) throw new NotFoundException('Trade not found');
      if (['COMPLETED', 'CANCELLED'].includes(trade.status)) {
        throw new BadRequestException('Cannot cancel finished trade');
      }

      if (trade.buyerId !== userId && trade.sellerId !== userId) {
        throw new ForbiddenException('Not authorized');
      }

      await tx.$executeRaw`SELECT * FROM orders WHERE id = ${trade.orderId} FOR UPDATE`;

      const order = await tx.order.findUnique({ where: { id: trade.orderId } });
      if (!order) throw new NotFoundException('Order not found');

      const newFilled = order.filledAmount.minus(trade.cryptoAmount);

      await tx.order.update({
        where: { id: order.id },
        data: {
          filledAmount: newFilled,
          status: newFilled.equals(0) ? 'OPEN' : 'PARTIAL',
        },
      });

      if (order.side === 'SELL') {
        const feeRate = new Prisma.Decimal(TRADING_FEE_RATE);
        const unlockAmount = trade.cryptoAmount.mul(
          new Prisma.Decimal(1).plus(feeRate),
        );

        const sellerWalletRef = await tx.wallet.findUnique({
          where: {
            userId_currencyCode: {
              userId: trade.sellerId,
              currencyCode: order.cryptoCurrency,
            },
          },
          select: { id: true },
        });

        if (!sellerWalletRef)
          throw new BadRequestException('Seller wallet not found');

        await tx.$executeRaw`SELECT * FROM wallets WHERE id = ${sellerWalletRef.id} FOR UPDATE`;

        const sellerWallet = await tx.wallet.findUnique({
          where: { id: sellerWalletRef.id },
        });

        if (!sellerWallet)
          throw new BadRequestException('Seller wallet not found after lock');

        await tx.wallet.update({
          where: { id: sellerWallet.id },
          data: {
            lockedBalance: { decrement: unlockAmount },
            availableBalance: { increment: unlockAmount },
          },
        });

        const cancelTx = await tx.transaction.create({
          data: {
            type: 'TRADE',
            status: 'POSTED',
            description: `Trade ${trade.id} cancelled — unlock escrow`,
          },
        });

        await tx.ledgerEntry.create({
          data: {
            transactionId: cancelTx.id,
            walletId: sellerWallet.id,
            amount: unlockAmount,
            balanceAfter: sellerWallet.availableBalance.plus(unlockAmount),
            entryType: 'CREDIT',
          },
        });
      }

      return tx.trade.update({
        where: { id: tradeId },
        data: { status: 'CANCELLED' },
      });
    });
  }
  async findOne(userId: string, tradeId: string) {
    const trade = await this.prisma.trade.findUnique({
      where: { id: tradeId },
      include: {
        order: true,
        buyer: { select: { id: true, fullName: true, email: true } },
        seller: { select: { id: true, fullName: true, email: true } },
      },
    });

    if (!trade) throw new NotFoundException('Trade not found');

    if (trade.buyerId !== userId && trade.sellerId !== userId) {
      throw new ForbiddenException('Not authorized to view this trade');
    }

    return trade;
  }
}
