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
}
