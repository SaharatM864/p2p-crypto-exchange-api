import { Controller, Get, UseGuards } from '@nestjs/common';
import { WalletsService } from './wallets.service';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { User } from '@prisma/client';

@ApiTags('Wallets')
@Controller('wallets')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class WalletsController {
  constructor(private readonly walletsService: WalletsService) {}

  @Get()
  @ApiOperation({ summary: 'Get my wallets balance' })
  @ApiResponse({
    status: 200,
    description: 'Return list of wallets with balances.',
  })
  getMyWallets(@CurrentUser() user: User) {
    return this.walletsService.getMyWallets(user.id);
  }
}
