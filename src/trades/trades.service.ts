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

      // Retrieve Wallets (Locking involved)
      const cryptoCode = trade.order.cryptoCurrency;

      const sellerWallet = await tx.wallet.findUnique({
        where: {
          userId_currencyCode: {
            userId: trade.sellerId,
            currencyCode: cryptoCode,
          },
        },
      });

      const buyerWallet = await tx.wallet.findUnique({
        where: {
          userId_currencyCode: {
            userId: trade.buyerId,
            currencyCode: cryptoCode,
          },
        },
      });

      if (!sellerWallet || !buyerWallet)
        throw new BadRequestException('Wallets not found');

      // Amount to transfer (Total trade amount)
      // Fee calculation: Buyer receives (Amount - Fee) or Seller pays fee?
      // Usually P2P: Taker pays fee if Taker is Buyer? checking logic...
      // Standard: Fee is deducted from the crypto amount being transferred.
      // Let's implement: Buyer gets (Amount * (1 - fee))

      // Wait, in Order creation we locked (Amount * (1+Fee)).
      // So Seller already paid/locked the fee.
      // Correct Logic:
      //   Seller Locked decreases by (Amount + Fee)
      //   Buyer Available increases by Amount
      //   System Fee Wallet increases by Fee (Ignored for now / or burned)

      const tradeAmount = trade.cryptoAmount;
      const feeRate = new Prisma.Decimal(TRADING_FEE_RATE);
      const feeAmount = tradeAmount.mul(feeRate);
      const totalDeductFromSeller = tradeAmount.plus(feeAmount);

      // 1. Deduct from Seller Locked
      await tx.wallet.update({
        where: { id: sellerWallet.id },
        data: { lockedBalance: { decrement: totalDeductFromSeller } },
      });

      // 2. Add to Buyer Available
      await tx.wallet.update({
        where: { id: buyerWallet.id },
        data: { availableBalance: { increment: tradeAmount } },
      });

      // 3. Create Transaction Record
      const transaction = await tx.transaction.create({
        data: {
          type: 'TRADE',
          status: 'POSTED',
          description: `Trade ${trade.id} release`,
        },
      });

      // 4. Create Ledger Entries
      // Seller Debit (Liability decrease)
      await tx.ledgerEntry.create({
        data: {
          transactionId: transaction.id,
          walletId: sellerWallet.id,
          amount: totalDeductFromSeller.negated(),
          balanceAfter: sellerWallet.lockedBalance.minus(totalDeductFromSeller), // Approximate
          entryType: 'DEBIT',
        },
      });

      // Buyer Credit (Liability increase from exchange perspective)
      await tx.ledgerEntry.create({
        data: {
          transactionId: transaction.id,
          walletId: buyerWallet.id,
          amount: tradeAmount,
          balanceAfter: buyerWallet.availableBalance.plus(tradeAmount),
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
