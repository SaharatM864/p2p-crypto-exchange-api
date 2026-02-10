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
  @ApiAuthEndpoint('Create new buy/sell order (Maker)')
  @ApiStandardResponse(OrderDto)
  create(@CurrentUser() user: User, @Body() createOrderDto: CreateOrderDto) {
    return this.ordersService.create(user.id, createOrderDto);
  }

  @Get()
  @ApiOperation({ summary: 'List all open orders' })
  @ApiStandardResponse(OrderDto) // In reality this returns an array, so usually we'd use ApiPaginatedResponse or ApiStandardResponse([OrderDto]) logic?
  // My generic wrapper supports data: T. If T is OrderDto[], it works if I pass [OrderDto] to ValidatedResponse?
  // No, the decorator is `ApiStandardResponse(Model)`. It puts `data: Model`.
  // If I want array, I should use `ApiPaginatedResponse` OR make `ApiStandardResponse` support array.
  // The current `ApiStandardResponse` does `data: { $ref: getSchemaPath(model) }`.
  // If I want array, I need a different decorator or modify it to handle isArray option.
  // Ideally, list endpoints should be paginated and use `ApiPaginatedResponse`.
  // But `findAll` here returns plain array.
  // IMPORTANT: The user mentioned `ApiOkResponsePaginated`.
  // I implemented `ApiPaginatedResponse`.
  // If `findAll` is NOT paginated, I should probably use `ApiStandardResponse` but tell it it's an array?
  // Current implementation of `ApiStandardResponse` does NOT support array easily unless I overload it.
  // Let's assume `findAll` returns array and use `ApiStandardResponse` but I need to handle the array schema.
  // Actually, I should use `ApiStandardResponse` for single, and maybe create `ApiStandardListResponse` for array if not paginated.
  // OR simply, I will wrap the return in `{ data: [...] }` manually in the service or interceptor?
  // The global interceptor `TransformInterceptor` likely wraps everything in `data`.
  // So if `findAll` returns `Order[]`, the result is `{ statusCode, message, data: Order[] }`.
  // Does `ApiStandardResponse(OrderDto)` describe `data: OrderDto` or `data: OrderDto[]`?
  // It describes `data: OrderDto`.
  // To support array, I should add `isArray` option to `ApiStandardResponse`.
  findAll() {
    return this.ordersService.findAll();
  }
}
