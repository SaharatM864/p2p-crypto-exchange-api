import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ApiAuthEndpoint } from '../common/decorators/api-auth-endpoint.decorator';
import { ApiStandardResponse } from '../common/decorators/api-standard-response.decorator';
import { OrderDto } from './dto/order.dto';

import type { User } from '@prisma/client';

@ApiTags('Orders')
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiAuthEndpoint(
    'สร้างคำสั่งซื้อ/ขาย (Maker)',
    'สร้างคำสั่งประกาศซื้อหรือขาย Crypto (BUY/SELL) กรณีสร้าง SELL Order ระบบจะล็อคยอดเหรียญ + ค่าธรรมเนียม 0.1% จาก Wallet ของผู้ประกาศทันที (Escrow) หากยอดเงินไม่เพียงพอจะส่ง Error กลับ',
  )
  @ApiStandardResponse(OrderDto)
  create(@CurrentUser() user: User, @Body() createOrderDto: CreateOrderDto) {
    return this.ordersService.create(user.id, createOrderDto);
  }

  @Get()
  @ApiOperation({
    summary: 'ดูรายการคำสั่งซื้อ/ขายที่เปิดอยู่',
    description:
      'เปิดสาธารณะ (ไม่ต้องยืนยันตัวตน) — แสดงรายการ Order ทั้งหมดที่มีสถานะ OPEN หรือ PARTIAL เรียงจากล่าสุดก่อน ใช้สำหรับให้ Taker เลือก Order ที่ต้องการเทรด',
  })
  @ApiStandardResponse(OrderDto)
  findAll() {
    return this.ordersService.findAll();
  }
}
