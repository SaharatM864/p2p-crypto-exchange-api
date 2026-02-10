import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { TradesService } from './trades.service';
import { CreateTradeDto } from './dto/create-trade.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { User } from '@prisma/client';

@ApiTags('Trades')
@Controller('trades')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class TradesController {
  constructor(private readonly tradesService: TradesService) {}

  @Post()
  @ApiOperation({ summary: 'Create new trade (Taker)' })
  create(@CurrentUser() user: User, @Body() dto: CreateTradeDto) {
    return this.tradesService.create(user.id, dto);
  }

  @Post(':id/pay')
  @ApiOperation({ summary: 'Mark trade as PAID (Buyer only)' })
  markPaid(@CurrentUser() user: User, @Param('id') id: string) {
    return this.tradesService.markPaid(user.id, id);
  }

  @Post(':id/release')
  @ApiOperation({ summary: 'Release crypto (Seller only)' })
  release(@CurrentUser() user: User, @Param('id') id: string) {
    return this.tradesService.release(user.id, id);
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancel trade' })
  cancel(@CurrentUser() user: User, @Param('id') id: string) {
    return this.tradesService.cancel(user.id, id);
  }
}
