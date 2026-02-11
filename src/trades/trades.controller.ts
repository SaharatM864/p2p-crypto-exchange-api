import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { TradesService } from './trades.service';
import { CreateTradeDto } from './dto/create-trade.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ApiTags } from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { ApiAuthEndpoint } from '../common/decorators/api-auth-endpoint.decorator';
import { ApiStandardResponse } from '../common/decorators/api-standard-response.decorator';
import { TradeDto } from './dto/trade.dto';

@ApiTags('Trades')
@Controller('trades')
@UseGuards(JwtAuthGuard)
export class TradesController {
  constructor(private readonly tradesService: TradesService) {}

  @Post()
  @ApiAuthEndpoint(
    'สร้างรายการเทรด (Taker)',
    'ตอบรับ Order ที่เปิดอยู่เพื่อเริ่มต้นการซื้อขาย ต้องระบุ orderId และจำนวน Crypto ที่ต้องการ ไม่สามารถเทรดกับ Order ของตัวเองได้ ระบบจะตรวจสอบจำนวนคงเหลือใน Order และเปลี่ยนสถานะเป็น PENDING_PAYMENT',
  )
  @ApiStandardResponse(TradeDto)
  create(@CurrentUser() user: User, @Body() dto: CreateTradeDto) {
    return this.tradesService.create(user.id, dto);
  }

  @Post(':id/pay')
  @ApiAuthEndpoint(
    'แจ้งชำระเงินแล้ว (เฉพาะผู้ซื้อ)',
    'เฉพาะผู้ซื้อเท่านั้นที่สามารถเรียกใช้ได้ ใช้สำหรับแจ้งว่าได้โอนเงิน Fiat ให้ผู้ขายแล้ว สถานะ Trade จะเปลี่ยนจาก PENDING_PAYMENT → PAID',
  )
  @ApiStandardResponse(TradeDto)
  markPaid(@CurrentUser() user: User, @Param('id') id: string) {
    return this.tradesService.markPaid(user.id, id);
  }

  @Post(':id/release')
  @ApiAuthEndpoint(
    'ปล่อยเหรียญ Crypto (เฉพาะผู้ขาย)',
    'เฉพาะผู้ขายเท่านั้นที่สามารถเรียกใช้ได้ ใช้สำหรับยืนยันว่าได้รับเงินแล้วและปล่อยเหรียญให้ผู้ซื้อ ระบบจะโอน Crypto จาก Locked Balance ของผู้ขาย → Available Balance ของผู้ซื้อ พร้อมหักค่าธรรมเนียม 0.1% เข้ากระเป๋าระบบ (Double-Entry Ledger) สถานะ Trade จะเปลี่ยนเป็น COMPLETED',
  )
  @ApiStandardResponse(TradeDto)
  release(@CurrentUser() user: User, @Param('id') id: string) {
    return this.tradesService.release(user.id, id);
  }

  @Post(':id/cancel')
  @ApiAuthEndpoint(
    'ยกเลิกรายการเทรด',
    'ผู้ซื้อหรือผู้ขายสามารถเรียกใช้ได้ ไม่สามารถยกเลิก Trade ที่สถานะเป็น COMPLETED หรือ CANCELLED แล้ว กรณีเป็น SELL Order ระบบจะคืนเหรียญที่ล็อคไว้ (รวมค่าธรรมเนียม) กลับเข้า Available Balance ของผู้ขาย และคืนจำนวน filledAmount ใน Order',
  )
  @ApiStandardResponse(TradeDto)
  cancel(@CurrentUser() user: User, @Param('id') id: string) {
    return this.tradesService.cancel(user.id, id);
  }
}
