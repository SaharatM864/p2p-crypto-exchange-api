import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import type { User } from '@prisma/client';

@ApiTags('Orders')
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create new buy/sell order (Maker)' })
  @ApiResponse({ status: 201, description: 'Order created successfully.' })
  create(@CurrentUser() user: User, @Body() createOrderDto: CreateOrderDto) {
    return this.ordersService.create(user.id, createOrderDto);
  }

  @Get()
  @ApiOperation({ summary: 'List all open orders' })
  findAll() {
    return this.ordersService.findAll();
  }
}
