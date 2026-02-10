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
      // 1. Lock Order Row (Pessimistic Lock workaround via raw query)
      // This ensures no one else can modify this order while we are processing
      await tx.$executeRaw`SELECT * FROM orders WHERE id = ${dto.orderId}::uuid FOR UPDATE`;

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

      // 2. Validate Amount
      const tradeAmount = new Prisma.Decimal(dto.amount);
      const remainingAmount = order.totalAmount.minus(order.filledAmount);

      if (tradeAmount.greaterThan(remainingAmount)) {
        throw new BadRequestException('Insufficient amount in order');
      }

      // 3. Create Trade
      const isBuyOrder = order.side === 'BUY';
      // If Order is SELL, Maker is Seller, Taker (userId) is Buyer
      // If Order is BUY, Maker is Buyer, Taker (userId) is Seller

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

      // 4. Update Order Filled Amount
      // Note logic: We do NOT deduct totalAmount, we track filledAmount
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
    const trade = await this.prisma.trade.findUnique({
      where: { id: tradeId },
    });

    if (!trade) throw new NotFoundException('Trade not found');
    if (trade.buyerId !== userId)
      throw new ForbiddenException('Only buyer can mark as paid');
    if (trade.status !== 'PENDING_PAYMENT')
      throw new BadRequestException('Invalid trade status');

    return this.prisma.trade.update({
      where: { id: tradeId },
      data: { status: 'PAID' },
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

      // --- DOUBLE ENTRY LEDGER LOGIC ---
      // 1. Move Asset from Seller (Locked) -> Buyer (Available)
      // Note: In SELL Order, asset was ALREADY moved from Available -> Locked when Order created.
      // So here we move Locked -> Buyer.Available

      // Retrieve System Fee Wallet First
      const systemFeeUser = await tx.user.findUnique({
        where: { email: 'fees@p2p.com' },
      });

      if (!systemFeeUser) throw new Error('System Fee User not found');

      const cryptoCode = trade.order.cryptoCurrency;

      // 1. Identify IDs for locking (Locking all 3 wallets involved)
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

      // 2. EXECUTE PESSIMITIC LOCKS
      // Locking seller, buyer, and system fee wallet rows
      await tx.$executeRaw`SELECT * FROM wallets WHERE id IN (${sellerWalletId}::uuid, ${buyerWalletId}::uuid, ${systemFeeWalletId}::uuid) FOR UPDATE`;

      // 3. RE-READ Wallets after lock to get latest balances
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

      // 4. Update Balances

      // Deduct from Seller Locked (Amount + Fee)
      await tx.wallet.update({
        where: { id: sellerWallet.id },
        data: { lockedBalance: { decrement: totalDeductFromSeller } },
      });

      // Add to Buyer Available (Amount)
      await tx.wallet.update({
        where: { id: buyerWallet.id },
        data: { availableBalance: { increment: tradeAmount } },
      });

      // Add Fee to System Wallet
      await tx.wallet.update({
        where: { id: systemFeeWallet.id },
        data: { availableBalance: { increment: feeAmount } },
      });

      // 5. Create Transaction Record
      const transaction = await tx.transaction.create({
        data: {
          type: 'TRADE',
          status: 'POSTED',
          description: `Trade ${trade.id} release`,
        },
      });

      // 6. Create Ledger Entries

      // 6.1 Seller Debit (Liability decrease) - Full Amount + Fee
      await tx.ledgerEntry.create({
        data: {
          transactionId: transaction.id,
          walletId: sellerWallet.id,
          amount: totalDeductFromSeller.negated(),
          balanceAfter: sellerWallet.lockedBalance.minus(totalDeductFromSeller),
          entryType: 'DEBIT',
        },
      });

      // 6.2 Buyer Credit (Liability increase) - Trade Amount
      await tx.ledgerEntry.create({
        data: {
          transactionId: transaction.id,
          walletId: buyerWallet.id,
          amount: tradeAmount,
          balanceAfter: buyerWallet.availableBalance.plus(tradeAmount),
          entryType: 'CREDIT',
        },
      });

      // 6.3 System Fee Credit (Liability increase) - Fee Amount
      await tx.ledgerEntry.create({
        data: {
          transactionId: transaction.id,
          walletId: systemFeeWallet.id,
          amount: feeAmount,
          balanceAfter: systemFeeWallet.availableBalance.plus(feeAmount),
          entryType: 'CREDIT',
        },
      });

      // Update Trade Status
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
      const trade = await tx.trade.findUnique({
        where: { id: tradeId },
        include: { order: true },
      });

      if (!trade) throw new NotFoundException('Trade not found');
      // Only allow cancel if not completed
      if (['COMPLETED', 'CANCELLED'].includes(trade.status)) {
        throw new BadRequestException('Cannot cancel finished trade');
      }

      // Logic: Only Buyer can cancel if PENDING_PAYMENT
      // Logic: Both can cancel in dispute? For simplicity: Buyer cancels or Admin cancels.
      // Here: User cancellation
      if (trade.buyerId !== userId && trade.sellerId !== userId) {
        throw new ForbiddenException('Not authorized');
      }

      // Restore Order Amount
      // filledAmount -= tradeAmount
      // Status check: if was COMPLETED, becomes OPEN/PARTIAL

      const order = await tx.order.findUnique({ where: { id: trade.orderId } });

      if (!order) {
        throw new NotFoundException('Order not found');
      }

      const newFilled = order.filledAmount.minus(trade.cryptoAmount);

      await tx.order.update({
        where: { id: order.id },
        data: {
          filledAmount: newFilled,
          status: newFilled.equals(0) ? 'OPEN' : 'PARTIAL',
        },
      });

      return tx.trade.update({
        where: { id: tradeId },
        data: { status: 'CANCELLED' },
      });
    });
  }
}
