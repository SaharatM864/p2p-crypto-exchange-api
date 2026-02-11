import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class WalletsService {
  constructor(private prisma: PrismaService) {}

  async getMyWallets(userId: string) {
    const wallets = await this.prisma.wallet.findMany({
      where: { userId },
      include: {
        currency: true,
      },
      orderBy: {
        currencyCode: 'asc',
      },
    });

    // Transform response for better readability
    return wallets.map((wallet) => ({
      id: wallet.id,
      currencyCode: wallet.currencyCode,
      currencyName: wallet.currency.name,
      currencyType: wallet.currency.type,
      // Convert Decimal to string to preserve precision in JSON
      availableBalance: wallet.availableBalance.toString(),
      lockedBalance: wallet.lockedBalance.toString(),
      pendingBalance: wallet.pendingBalance.toString(),
      // Calculated total
      totalBalance: wallet.availableBalance
        .plus(wallet.lockedBalance)
        .plus(wallet.pendingBalance)
        .toString(),
    }));
  }
  async getUserTransactions(
    userId: string,
    query: { page?: number; limit?: number } = {},
  ) {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    // Use Prisma transaction to get count and data efficiently
    const [total, transactions] = await this.prisma.$transaction([
      this.prisma.ledgerEntry.count({
        where: { wallet: { userId } },
      }),
      this.prisma.ledgerEntry.findMany({
        where: { wallet: { userId } },
        include: {
          transaction: true,
          wallet: true,
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    return {
      data: transactions.map((entry) => ({
        id: entry.transaction.id,
        type: entry.transaction.type,
        status: entry.transaction.status,
        description: entry.transaction.description,
        amount: entry.amount.toString(), // Check entry type for sign if needed (Debit is neg, Credit is pos in ledger)
        currency: entry.wallet.currencyCode,
        balanceAfter: entry.balanceAfter.toString(),
        createdAt: entry.createdAt,
      })),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}
