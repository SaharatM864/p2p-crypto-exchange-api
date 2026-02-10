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
  @ApiAuthEndpoint('Create new trade (Taker)')
  @ApiStandardResponse(TradeDto)
  create(@CurrentUser() user: User, @Body() dto: CreateTradeDto) {
    return this.tradesService.create(user.id, dto);
  }

  @Post(':id/pay')
  @ApiAuthEndpoint('Mark trade as PAID (Buyer only)')
  @ApiStandardResponse(TradeDto)
  markPaid(@CurrentUser() user: User, @Param('id') id: string) {
    return this.tradesService.markPaid(user.id, id);
  }

  @Post(':id/release')
  @ApiAuthEndpoint('Release crypto (Seller only)')
  @ApiStandardResponse(TradeDto)
  release(@CurrentUser() user: User, @Param('id') id: string) {
    return this.tradesService.release(user.id, id);
  }

  @Post(':id/cancel')
  @ApiAuthEndpoint('Cancel trade')
  @ApiStandardResponse(TradeDto)
  cancel(@CurrentUser() user: User, @Param('id') id: string) {
    return this.tradesService.cancel(user.id, id);
  }
}
