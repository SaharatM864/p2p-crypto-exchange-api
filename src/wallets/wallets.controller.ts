import { Controller, Get, UseGuards } from '@nestjs/common';
import { WalletsService } from './wallets.service';
import { ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ApiAuthEndpoint } from '../common/decorators/api-auth-endpoint.decorator';
import { ApiStandardResponse } from '../common/decorators/api-standard-response.decorator';
import { WalletDto } from './dto/wallet.dto';
import type { User } from '@prisma/client';

@ApiTags('Wallets')
@Controller('wallets')
@UseGuards(JwtAuthGuard)
export class WalletsController {
  constructor(private readonly walletsService: WalletsService) {}

  @Get()
  @ApiAuthEndpoint(
    'ดูยอดเงินในกระเป๋าของฉัน',
    'แสดงรายการ Wallet ทั้งหมดของผู้ใช้ปัจจุบัน พร้อมยอดคงเหลือแยกตาม Available, Locked, Pending และ Total เรียงตามรหัสสกุลเงิน (A-Z)',
  )
  @ApiStandardResponse(WalletDto, { isArray: true })
  getMyWallets(@CurrentUser() user: User) {
    return this.walletsService.getMyWallets(user.id);
  }
}
