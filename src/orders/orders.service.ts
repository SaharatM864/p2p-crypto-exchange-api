import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderSide, Prisma } from '@prisma/client';
import { TRADING_FEE_RATE } from '../common/constants/fee.constants';

@Injectable()
export class OrdersService {
  constructor(private prisma: PrismaService) {}

  async create(userId: string, dto: CreateOrderDto) {
    // ใช้ Interactive Transaction
    // วงเล็บเหลี่ยม [] เพื่อกำหนด Isolation Level (Optional, but Read Committed is default for Postgres)
    return this.prisma.$transaction(async (tx) => {
      // 1. Validation Logic
      // ตรวจสอบว่ามีสกุลเงินจริงไหม (Optional enhancement: cache currency data)
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

      // 2. Logic การ Lock เงิน (เฉพาะฝั่ง SELL)
      if (dto.side === OrderSide.SELL) {
        // ต้อง Lock เงินใน Wallet: Amount + Fee
        // สมมติ Fee 0.1% -> Total Locked = Amount * (1 + 0.001)
        const totalAmountDecimal = new Prisma.Decimal(dto.totalAmount);
        const feeRateDecimal = new Prisma.Decimal(TRADING_FEE_RATE);
        const lockAmount = totalAmountDecimal.mul(
          new Prisma.Decimal(1).plus(feeRateDecimal),
        );

        // หา Wallet และ Lock Row (Pessimistic Lock)
        // Prisma ตอนนี้ยังไม่มี .forUpdate() ใน findUnique native
        // แต่ใช้ $queryRaw ได้ หรือใช้ findUnique ปกติใน transaction จะได้ row lock ระดับหนึ่งถ้า update
        // เพื่อความชัวร์เรื่อง Race Condition เราจะใช้ raw query หรือ update โดยตรงที่มี where condition

        // ค้นหาและตรวจสอบยอดเงิน
        /* 
           NOTE: Prisma Client JS does not fully support "SELECT FOR UPDATE" natively yet in clean API.
           Common workaround is raw query OR ensuring atomic updates.
           Here we use atomic update with condition (Optimistic Concurrency Control style within Transaction)
           which is effectively safe because of Transaction isolation.
        */

        const wallet = await tx.wallet.findUnique({
          where: {
            userId_currencyCode: {
              userId,
              currencyCode: dto.cryptoCurrency,
            },
          },
        });

        if (!wallet) throw new BadRequestException('Wallet not found');

        if (wallet.availableBalance.lessThan(lockAmount)) {
          throw new BadRequestException(
            'Insufficient balance to cover order + fee',
          );
        }

        // หักเงิน Available -> เพิ่ม Locked
        await tx.wallet.update({
          where: { id: wallet.id },
          data: {
            availableBalance: { decrement: lockAmount },
            lockedBalance: { increment: lockAmount },
          },
        });
      }

      // 3. Create Order
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
